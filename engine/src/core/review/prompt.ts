/**
 * Reviewer prompt construction.
 *
 * The policy is supplied as a separate system message rather than pasted into
 * the user turn, because it is the same for every file. That keeps the per-file
 * user message small, which is the difference between a review that fits a
 * context window and one that does not.
 *
 * Line numbers are included in the content on purpose. The reviewer can only
 * cite a line it was shown, which makes the validator's line check a real check
 * rather than a formality.
 */

import type { FileContext, RelatedFile } from "../repository/context.ts";
import { profileLine } from "../repository/context.ts";
import type { PromptBundle } from "./prompts.ts";

export interface ReviewerPromptInput {
  bundle: PromptBundle;
  context: FileContext;
  /** Upper bound the model is told to respect. */
  maxFindings: number;
  /** Empty means the whole file is in scope. */
  changedLines: ReadonlySet<number>;
  /** Files this one imports, so a changed contract can be judged. */
  related?: readonly RelatedFile[] | undefined;
}

export interface SystemPromptInput {
  bundle: PromptBundle;
  maxFindings: number;
  /**
   * One line describing the project, for example `node project using bun`.
   * Empty when the repository has no manifest to read it from.
   */
  projectLine?: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const persona = input.bundle.persona.replaceAll("{{MAX_FINDINGS}}", String(Math.max(1, input.maxFindings)));
  const project = input.projectLine !== undefined && input.projectLine !== "" ? `\n\nProject: ${input.projectLine}` : "";
  return `${persona}${project}\n\n--- BEGIN REVIEW BAR ---\n\n${input.bundle.policy}\n\n--- END REVIEW BAR ---`;
}

/**
 * Compresses a line set into ranges. A 300-line diff is far more useful to the
 * model as `10-40, 88, 120-160` than as a list of 300 numbers.
 */
export function formatLineRanges(lines: ReadonlySet<number>): string {
  const sorted = [...lines].sort((a, b) => a - b);
  if (sorted.length === 0) return "";

  const ranges: string[] = [];
  let start = sorted[0] ?? 0;
  let previous = start;

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] ?? 0;
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);

  return ranges.join(", ");
}

export function buildUserPrompt(input: ReviewerPromptInput): string {
  const { context } = input;
  const sections: string[] = [];

  sections.push(`Review the following file from the repository.`);

  sections.push(
    [
      `File: ${context.file.path}`,
      `Profile: ${profileLine(context)}`,
    ].join("\n"),
  );

  if (input.changedLines.size > 0) {
    sections.push(
      [
        `Scope: this is a diff review. Only these lines of the new file are in scope:`,
        `  ${formatLineRanges(input.changedLines)}`,
        `Report a defect only if its anchor line is one of those lines. Code outside the range is`,
        `supplied as context so you can judge whether the change breaks its neighbours.`,
      ].join("\n"),
    );
  } else {
    sections.push(`Scope: the whole file is in scope.`);
  }

  // Imported files supply the contract this file has to honour. Their bodies
  // are never sent: the export surface is what a caller can depend on.
  if (input.related !== undefined && input.related.length > 0) {
    const lines = input.related.slice(0, 10).map((related) => `  ${related.path} | ${related.profile}`);
    sections.push(
      [
        `These reviewed files are imported by the file above. Their bodies are not shown.`,
        `Use them to judge whether the code keeps the contract these exports imply.`,
        ...lines,
      ].join("\n"),
    );
  }

  const windows = context.windows.map((window) => window.text).join("\n...\n");
  sections.push([`--- BEGIN FILE CONTENT ---`, windows, `--- END FILE CONTENT ---`].join("\n"));

  sections.push(
    [
      `Line numbers shown above are authoritative. Cite them exactly.`,
      `Return at most ${input.maxFindings} findings.`,
      `Return one JSON object and nothing else.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}
