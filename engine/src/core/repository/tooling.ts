/**
 * Repository tooling detection.
 *
 * The review bar forbids reporting anything a linter already reports. Honouring
 * that requires knowing whether the repository actually configures one, so this
 * module answers one question per language family: will the project's own
 * tooling already flag this class of defect?
 *
 * Config names are probed directly in the base directory rather than inferred
 * from the discovered file list. The two differ whenever a review is scoped to a
 * subdirectory, and inferring from the file list would then report "no linter"
 * about a repository that plainly has one.
 */

import type { LanguageFamily } from "../languages/detect.ts";
import type { FileSystemPort } from "../ports.ts";

export interface ToolingProfile {
  /** Families whose tooling already covers lint-duplicating detectors. */
  lintedFamilies: LanguageFamily[];
  /** Config paths that led to each conclusion, for the review report. */
  linterConfigs: string[];
}

const JS_LINTER_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
  "biome.json",
  "biome.jsonc",
  ".oxlintrc.json",
];

const PYTHON_LINTER_FILES = [
  "ruff.toml",
  ".ruff.toml",
  ".flake8",
  ".pylintrc",
  ".mypy.ini",
];

export async function detectTooling(fs: FileSystemPort, baseDir: string): Promise<ToolingProfile> {
  const lintedFamilies = new Set<LanguageFamily>();
  const linterConfigs: string[] = [];

  for (const name of JS_LINTER_FILES) {
    if (await fs.exists(fs.join(baseDir, name))) {
      lintedFamilies.add("js");
      linterConfigs.push(name);
    }
  }

  for (const name of PYTHON_LINTER_FILES) {
    if (await fs.exists(fs.join(baseDir, name))) {
      lintedFamilies.add("python");
      linterConfigs.push(name);
    }
  }

  // `package.json` can carry the whole ESLint configuration, or the dependency
  // that would run it, with no standalone config file existing at all.
  if (!lintedFamilies.has("js") && (await fs.exists(fs.join(baseDir, "package.json")))) {
    const manifest = await readIfPresent(fs, fs.join(baseDir, "package.json"));
    if (manifest !== null && /"eslintConfig"\s*:|"eslint"\s*:|\beslint\b/.test(manifest)) {
      lintedFamilies.add("js");
      linterConfigs.push("package.json");
    }
  }

  // `pyproject.toml` normally exists for packaging alone, so its presence
  // proves nothing. Only a tool section inside it counts.
  if (!lintedFamilies.has("python") && (await fs.exists(fs.join(baseDir, "pyproject.toml")))) {
    const config = await readIfPresent(fs, fs.join(baseDir, "pyproject.toml"));
    if (config !== null && /\[tool\.(ruff|flake8|pylint|mypy)\b/.test(config)) {
      lintedFamilies.add("python");
      linterConfigs.push("pyproject.toml");
    }
  }

  if (!lintedFamilies.has("python") && (await fs.exists(fs.join(baseDir, "setup.cfg")))) {
    const config = await readIfPresent(fs, fs.join(baseDir, "setup.cfg"));
    if (config !== null && /\[flake8\]/.test(config)) {
      lintedFamilies.add("python");
      linterConfigs.push("setup.cfg");
    }
  }

  return {
    lintedFamilies: [...lintedFamilies].sort(),
    linterConfigs: [...new Set(linterConfigs)].sort(),
  };
}

async function readIfPresent(fs: FileSystemPort, absolutePath: string): Promise<string | null> {
  try {
    return await fs.readTextFile(absolutePath);
  } catch {
    // An unreadable config means a linter cannot be proven to be configured, and
    // the safe default is to keep the detector rather than silently lose it.
    return null;
  }
}
