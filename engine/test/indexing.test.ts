import { describe, expect, it } from "bun:test";
import path from "node:path";
import { createNodeFileSystem } from "../src/adapters/node-fs.ts";
import { fileSignals, hotspotFor, indexRepository } from "../src/core/indexing/index-repository.ts";
import { HOTSPOT_LIMIT } from "../src/core/indexing/catalog.ts";
import { ReviewEngine } from "../src/core/review/engine.ts";
import type { AiReviewRequest, AiReviewerPort, ReviewEvent } from "../src/core/ports.ts";

const PROMPTS_DIR = path.join(import.meta.dir, "..", "prompts");
const FIXTURES = path.join(import.meta.dir, "fixtures");

describe("file signals ported from the Rust indexer", () => {
  it("counts marker types present, not marker occurrences", () => {
    // `fetch(` appears three times and `.query(` twice; the Rust indexer counted
    // distinct markers, so a file that calls the same sink repeatedly is not
    // ranked as though it had more sinks. This is the assertion that catches a
    // regression to occurrence counting.
    const content = "fetch(a);\nfetch(b);\nfetch(c);\ndb.query(x);\ndb.query(y);";

    expect(fileSignals("src/client.ts", content).sinkHits).toBe(2);
  });

  it("treats an auth path as an auth boundary even when the body is neutral", () => {
    const signals = fileSignals("src/auth/session.ts", "export type Session = { id: string };");

    expect(signals.authHit).toBe(true);
    expect(signals.routeHit).toBe(false);
  });

  it("scores a file by the ported weights", () => {
    const signals = fileSignals(
      "src/api.ts",
      "router.get('/x', handler); // request.body\nconst token = request.headers.authorization;\neval(input);",
    );

    // route 6 + auth 5 + source 3 + sink 4
    expect(hotspotFor(signals)).toEqual({
      score: 18,
      reasons: ["request entrypoint", "auth boundary", "untrusted input", "sensitive sink"],
    });
  });
});

describe("repository index", () => {
  it("reads manifests and languages from paths, without content", () => {
    const index = indexRepository({
      paths: ["package.json", "pyproject.toml", "src/app.ts", "src/app.tsx", "src/notes.md"],
      contents: new Map(),
    });

    expect(index.manifests).toEqual(["package.json", "pyproject.toml"]);
    expect(index.languages["typescript"]).toBe(2);
    // Nothing was read, so no marker total may be reported as a real count.
    expect(index.contentUnavailable).toBe(true);
    expect(index.sourceMarkers).toBe(0);
  });

  it("keeps the strongest hotspots and applies the path tie-break at the limit", () => {
    // One route file (6) plus more sink files (4 each) than the cap allows, so
    // the bounded insert has to decide which equal-scoring files survive. The
    // tie-break is by path, which is what makes the ranking deterministic.
    const sinkPaths = Array.from({ length: HOTSPOT_LIMIT + 6 }, (_, position) => {
      const ordinal = String(position + 1).padStart(2, "0");
      return `src/sink-${ordinal}.ts`;
    });
    const contents = new Map<string, string>([
      ["src/route.ts", "router.get('/x', handler);"],
      ...sinkPaths.map((file) => [file, "os.system(command);"] as const),
    ]);

    const index = indexRepository({ paths: ["src/route.ts", ...sinkPaths], contents });

    expect(index.hotspots).toHaveLength(HOTSPOT_LIMIT);
    expect(index.hotspots[0]?.file).toBe("src/route.ts");
    expect(index.hotspots[0]?.score).toBe(6);

    // The route file is stronger, so it holds one of the 24 slots and only the
    // 23 earliest sinks survive. The kept set is pinned exactly rather than
    // sampled: a cap that admitted one file too many, or evicted the wrong one,
    // would still satisfy a "contains" check on a single path.
    const kept = index.hotspots.map((hotspot) => hotspot.file).sort();
    const expected = ["src/route.ts", ...sinkPaths.slice(0, HOTSPOT_LIMIT - 1)].sort();
    expect(kept).toEqual(expected);
    expect(kept).not.toContain(`src/sink-${HOTSPOT_LIMIT}.ts`);
  });

  it("counts route and auth files separately from their hotspot scores", () => {
    const index = indexRepository({
      paths: ["src/router.ts", "src/auth/token.ts"],
      contents: new Map([
        ["src/router.ts", "app.post('/login', handler);"],
        ["src/auth/token.ts", "const jwt = verify(token);"],
      ]),
    });

    expect(index.routeFiles).toBe(1);
    expect(index.authFiles).toBe(2);
    expect(index.contentUnavailable).toBe(false);
  });
});

describe("ReviewEngine repository intelligence", () => {
  function engineWith(options: { aiReviewer?: AiReviewerPort; maxAiFiles?: number; events?: ReviewEvent[] }) {
    const events = options.events;
    return new ReviewEngine({
      fs: createNodeFileSystem(),
      promptsDir: PROMPTS_DIR,
      ...(options.aiReviewer !== undefined ? { aiReviewer: options.aiReviewer } : {}),
      ...(options.maxAiFiles !== undefined ? { maxAiFiles: options.maxAiFiles } : {}),
      ...(events !== undefined ? { onEvent: (event: ReviewEvent) => events.push(event) } : {}),
    });
  }

  it("records what it understood about the repository", async () => {
    const report = await engineWith({}).review({ target: path.join(FIXTURES, "buggy") });

    expect(report.repositoryIndex.filesIndexed).toBeGreaterThan(0);
    expect(report.repositoryIndex.contentUnavailable).toBe(false);
    expect(report.repositoryIndex.languages["typescript"]).toBeGreaterThan(0);
  });

  it("emits an index event that carries no source content", async () => {
    const events: ReviewEvent[] = [];
    await engineWith({ events }).review({ target: path.join(FIXTURES, "buggy") });

    const indexEvent = events.find((event) => event.type === "index:done");
    expect(indexEvent).toBeDefined();
    expect(indexEvent?.message).not.toContain("Math.random");
    expect(indexEvent?.message).toContain("files indexed");
  });

  /**
   * The hotspot ordering only matters when the AI budget is smaller than the
   * target list, which is the normal case on a real repository. The requested
   * file is asserted on, not the number of calls: what matters is that the model
   * is shown the entrypoint before the budget is spent on alphabetically earlier
   * but harmless files.
   */
  it("shows the hotspot file to the model first when the budget is tight", async () => {
    const prompts: string[] = [];
    const recording: AiReviewerPort = {
      name: "recording",
      review: async (request: AiReviewRequest) => {
        prompts.push(request.userPrompt);
        return { verdict: "approve", summary: "nothing to report", findings: [] };
      },
    };

    await engineWith({ aiReviewer: recording, maxAiFiles: 1 }).review({ target: path.join(FIXTURES, "indexed") });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("z-entry.ts");
    expect(prompts[0]).not.toContain("a-plain.ts");
  });
});
