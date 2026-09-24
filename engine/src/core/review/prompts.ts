/**
 * Prompt asset loading.
 *
 * The review policy is prose, and prose belongs in a markdown file a reviewer
 * can read and change, not in a template literal. `shared_code_review_bar.md`
 * is the canonical policy inherited from the Python implementation; `reviewer.md`
 * is the engine's own persona and response schema.
 */

import type { FileSystemPort } from "../ports.ts";

export interface PromptBundle {
  /** The review bar. Canonical policy, shared by every reviewer stage. */
  policy: string;
  /** The reviewer persona and the exact response schema. */
  persona: string;
}

export const REQUIRED_PROMPT_FILES = ["shared_code_review_bar.md", "reviewer.md"] as const;

/**
 * Reads the prompt assets. Missing assets are a broken installation, not a
 * degraded runtime, so this fails loudly instead of reviewing with no policy.
 */
export async function loadPromptBundle(fs: FileSystemPort, promptsDir: string): Promise<PromptBundle> {
  const [policy, persona] = await Promise.all([
    fs.readTextFile(fs.join(promptsDir, REQUIRED_PROMPT_FILES[0])),
    fs.readTextFile(fs.join(promptsDir, REQUIRED_PROMPT_FILES[1])),
  ]);

  return { policy, persona };
}
