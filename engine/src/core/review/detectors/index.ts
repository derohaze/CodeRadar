/**
 * Detector registry.
 *
 * The registry is the one place that knows which detectors exist. Keeping that
 * decision here means the pipeline never has to think about it, and a detector
 * can be added without touching the engine.
 *
 * There is no per-repository suppression here any more. A detector that would
 * repeat a linter's finding was removed instead of being conditionally skipped:
 * a defect worth reporting only when the project happens to lack a linter is a
 * defect whose trigger nobody can state, which is the bar's definition of noise.
 */

import type { LanguageFamily } from "../../languages/detect.ts";
import type { CandidateFinding } from "../../findings/validate.ts";
import type { SourceFile } from "../../repository/source.ts";
import type { Detector, DetectorInput } from "./shared.ts";
import { JS_DETECTORS } from "./js.ts";
import { PYTHON_DETECTORS } from "./python.ts";

export type { Detector, DetectorInput } from "./shared.ts";

export const ALL_DETECTORS: readonly Detector[] = [...JS_DETECTORS, ...PYTHON_DETECTORS];

export function detectorsFor(language: { family: LanguageFamily }): Detector[] {
  return ALL_DETECTORS.filter((detector) => detector.families.includes(language.family));
}

/**
 * Runs the applicable detectors over one file.
 *
 * A detector that throws is contained here rather than allowed to abort the
 * review: a broken detector must degrade to silence, never to a failed run.
 */
export function runDetectors(
  file: SourceFile,
  language: { id: string; family: LanguageFamily },
): { candidates: CandidateFinding[]; failed: string[] } {
  const candidates: CandidateFinding[] = [];
  const failed: string[] = [];
  const input: DetectorInput = { file, language };

  for (const detector of detectorsFor(language)) {
    try {
      candidates.push(...detector.run(input));
    } catch {
      failed.push(detector.id);
    }
  }

  return { candidates, failed };
}
