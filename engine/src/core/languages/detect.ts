/**
 * Language and project detection.
 *
 * Detection is deterministic and offline on purpose. The AI reviewer is told
 * what the language is; it is never asked to work it out, because a wrong guess
 * silently changes which review rules apply.
 */

export type LanguageFamily = "js" | "python" | "rust" | "go" | "other";

export interface LanguageInfo {
  /** Stable id, used in the UI and to gate language-specific detectors. */
  id: string;
  family: LanguageFamily;
  /** Whether the review pipeline sends this file to a reviewer at all. */
  reviewable: boolean;
}

const UNKNOWN_LANGUAGE: LanguageInfo = { id: "unknown", family: "other", reviewable: false };

const EXTENSION_LANGUAGES: Record<string, LanguageInfo> = {
  ".ts": { id: "typescript", family: "js", reviewable: true },
  ".mts": { id: "typescript", family: "js", reviewable: true },
  ".cts": { id: "typescript", family: "js", reviewable: true },
  ".tsx": { id: "tsx", family: "js", reviewable: true },
  ".js": { id: "javascript", family: "js", reviewable: true },
  ".mjs": { id: "javascript", family: "js", reviewable: true },
  ".cjs": { id: "javascript", family: "js", reviewable: true },
  ".jsx": { id: "jsx", family: "js", reviewable: true },
  ".py": { id: "python", family: "python", reviewable: true },
  ".pyi": { id: "python", family: "python", reviewable: true },
  ".rs": { id: "rust", family: "rust", reviewable: true },
  ".go": { id: "go", family: "go", reviewable: true },
  ".java": { id: "java", family: "other", reviewable: true },
  ".kt": { id: "kotlin", family: "other", reviewable: true },
  ".rb": { id: "ruby", family: "other", reviewable: true },
  ".php": { id: "php", family: "other", reviewable: true },
  ".cs": { id: "csharp", family: "other", reviewable: true },
  ".c": { id: "c", family: "other", reviewable: true },
  ".h": { id: "c", family: "other", reviewable: true },
  ".cpp": { id: "cpp", family: "other", reviewable: true },
  ".cc": { id: "cpp", family: "other", reviewable: true },
  ".hpp": { id: "cpp", family: "other", reviewable: true },
  ".swift": { id: "swift", family: "other", reviewable: true },
  ".sh": { id: "shell", family: "other", reviewable: true },
  ".bash": { id: "shell", family: "other", reviewable: true },
  ".zsh": { id: "shell", family: "other", reviewable: true },
  ".ps1": { id: "powershell", family: "other", reviewable: true },
  ".sql": { id: "sql", family: "other", reviewable: true },
  ".vue": { id: "vue", family: "js", reviewable: true },
  ".svelte": { id: "svelte", family: "js", reviewable: true },
  // Config and markup are reviewable when they carry behaviour (CI, infra).
  ".yml": { id: "yaml", family: "other", reviewable: true },
  ".yaml": { id: "yaml", family: "other", reviewable: true },
  ".toml": { id: "toml", family: "other", reviewable: true },
  ".json": { id: "json", family: "other", reviewable: true },
  ".html": { id: "html", family: "other", reviewable: true },
  ".css": { id: "css", family: "other", reviewable: true },
  ".md": { id: "markdown", family: "other", reviewable: true },
  ".dockerfile": { id: "dockerfile", family: "other", reviewable: true },
};

/** Extension-less files with meaningful content. */
const FILENAME_LANGUAGES: Record<string, LanguageInfo> = {
  dockerfile: { id: "dockerfile", family: "other", reviewable: true },
  makefile: { id: "makefile", family: "other", reviewable: true },
  "cmakelists.txt": { id: "cmake", family: "other", reviewable: true },
};

const SHEBANG_LANGUAGES: ReadonlyArray<readonly [RegExp, LanguageInfo]> = [
  [/\bpython[0-9.]*\b/, { id: "python", family: "python", reviewable: true }],
  [/\b(node|bun|deno)\b/, { id: "javascript", family: "js", reviewable: true }],
  [/\b(bash|sh|zsh)\b/, { id: "shell", family: "other", reviewable: true }],
  [/\bruby\b/, { id: "ruby", family: "other", reviewable: true }],
];

function baseName(filePath: string): string {
  const normalised = filePath.replace(/\\/g, "/");
  const index = normalised.lastIndexOf("/");
  return index === -1 ? normalised : normalised.slice(index + 1);
}

function extensionOf(filePath: string): string {
  const name = baseName(filePath).toLowerCase();
  if (name === "") return "";
  const index = name.lastIndexOf(".");
  // A leading dot means a dotfile such as `.env`, not an extension.
  if (index <= 0) return "";
  return name.slice(index);
}

/**
 * Resolves a language from the path alone. `content` is optional and only used
 * to read a shebang, which is the one case a path cannot answer.
 */
export function detectLanguage(filePath: string, content?: string): LanguageInfo {
  const name = baseName(filePath).toLowerCase();

  const byFileName = FILENAME_LANGUAGES[name];
  if (byFileName) return byFileName;

  const byExtension = EXTENSION_LANGUAGES[extensionOf(filePath)];
  if (byExtension) return byExtension;

  if (content !== undefined && content.startsWith("#!")) {
    const firstLine = content.split("\n", 1)[0] ?? "";
    for (const [pattern, language] of SHEBANG_LANGUAGES) {
      if (pattern.test(firstLine)) return language;
    }
  }

  return UNKNOWN_LANGUAGE;
}

export function languageFamilyOf(filePath: string, content?: string): LanguageFamily {
  return detectLanguage(filePath, content).family;
}

/** Binary sniffing by NUL byte, which is what git and most tools use. */
export function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

/**
 * Minified or generated bundles are not reviewable: every line is a false
 * positive waiting to happen and the model cannot anchor anything in them.
 * A single line over 2,000 characters is the signal, since hand-written code
 * essentially never produces one.
 */
export function looksGenerated(content: string, sampleLines = 40): boolean {
  const lines = content.split("\n", sampleLines);
  for (const line of lines) {
    if (line.length > 2000) return true;
  }
  const markers = [
    "@generated",
    "DO NOT EDIT",
    "Code generated by",
    "eslint-disable",
    "/* eslint-disable */",
  ];
  const head = lines.join("\n");
  return markers.some((marker) => head.includes(marker));
}

export type ProjectKind =
  | "node"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "dotnet"
  | "ruby"
  | "php"
  | "unknown";

export interface ProjectProfile {
  kind: ProjectKind;
  /** Repository-relative path of the manifest that decided `kind`. */
  manifest: string | null;
  packageManager: string | null;
  /** Language ids present, most frequent first. */
  languages: string[];
}

/**
 * Manifests in priority order. Order matters: a repository with both
 * `package.json` and `pyproject.toml` is treated as a Node project because the
 * primary toolchain is the one that usually owns the build.
 */
const MANIFESTS: ReadonlyArray<readonly [string, ProjectKind]> = [
  ["package.json", "node"],
  ["pyproject.toml", "python"],
  ["Cargo.toml", "rust"],
  ["go.mod", "go"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "java"],
  ["composer.json", "php"],
  ["Gemfile", "ruby"],
];

const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["requirements.txt", "pip"],
  ["Pipfile.lock", "pipenv"],
  ["Cargo.lock", "cargo"],
];

/**
 * Reads the project shape from the repository-relative paths already
 * discovered. It deliberately does not read file contents: the lockfile names
 * are enough to name the package manager, and reading every manifest would be
 * more I/O for no better answer.
 */
export function detectProjectProfile(paths: readonly string[]): ProjectProfile {
  const normalised = paths.map((path) => path.replace(/\\/g, "/"));
  const names = new Set(normalised.map((path) => baseName(path)));

  let kind: ProjectKind = "unknown";
  let manifest: string | null = null;
  for (const [name, projectKind] of MANIFESTS) {
    if (!names.has(name)) continue;
    kind = projectKind;
    manifest = normalised.find((path) => baseName(path) === name) ?? name;
    break;
  }

  // A .NET project is identified by extension rather than a fixed file name.
  if (kind === "unknown") {
    const csproj = normalised.find((path) => path.toLowerCase().endsWith(".csproj"));
    if (csproj) {
      kind = "dotnet";
      manifest = csproj;
    }
  }

  let packageManager: string | null = null;
  for (const [name, manager] of LOCKFILES) {
    if (names.has(name)) {
      packageManager = manager;
      break;
    }
  }
  if (packageManager === null && kind === "python" && names.has("requirements.txt")) {
    packageManager = "pip";
  }

  const counts = new Map<string, number>();
  for (const path of normalised) {
    const language = detectLanguage(path);
    if (language.id === "unknown") continue;
    counts.set(language.id, (counts.get(language.id) ?? 0) + 1);
  }

  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  return { kind, manifest, packageManager, languages };
}
