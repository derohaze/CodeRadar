/**
 * Python detectors.
 *
 * The same rule as the JavaScript set applies: each one catches something a
 * type checker and the default linter configuration do not.
 */

import { buildEvidence, candidate, lineAt, stripHashComment } from "./shared.ts";
import type { Detector, DetectorInput } from "./shared.ts";

const PYTHON_FAMILIES = ["python"] as const;

const MUTABLE_DEFAULT =
  /=\s*(\[\s*\]|\{\s*\}|(?:dict|list|set|bytearray|OrderedDict|defaultdict)\s*\(\s*\))\s*(?:,|\))/;

/**
 * `def f(items=[]):` creates one list when the module is imported and shares it
 * across every call, so values accumulate between unrelated requests.
 *
 * No core lint rule reports this; it needs flake8-bugbear.
 */
export const mutableDefaultArgument: Detector = {
  id: "py.mutable-default-argument",
  axis: "correctness",
  families: PYTHON_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      const defMatch = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
      if (defMatch === null) continue;

      // A signature can span lines; gather until the parameter list closes.
      let signature = line;
      let signatureEnd = index;
      while (!signature.includes(")") && signatureEnd < index + 8 && signatureEnd < input.file.lines.length - 1) {
        signatureEnd += 1;
        signature += ` ${lineAt(input.file, signatureEnd)}`;
      }

      const defaultMatch = MUTABLE_DEFAULT.exec(signature);
      if (defaultMatch === null) continue;

      const functionName = defMatch[2] ?? "the function";
      const literal = defaultMatch[1] ?? "[]";

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: signatureEnd + 1,
          severity: "high",
          axis: "correctness",
          title: "Mutable default argument is shared across calls",
          problem: `\`${functionName}\` uses \`${literal}\` as a default argument value.`,
          why: "Default values are evaluated once, when the `def` statement runs, not on each call. Every call that omits the argument receives the same object, so mutations persist between callers.",
          impact: `State leaks between unrelated calls: a value written into \`${literal}\` during one request is still present during the next, which turns a per-request value into process-wide state.`,
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: `the function is called twice without the argument`,
            wrongResult: `the second call sees the object mutated by the first, because \`${literal}\` was created once`,
          }),
          confidence: 90,
          fix: `Default to \`None\` and create the container inside the body: \`def ${functionName}(..., value=None):\` followed by \`value = ${literal} if value is None else value\`.`,
          suggestedPatch: null,
          suggestedTest: `Call \`${functionName}\` twice with the argument omitted and assert the result of the second call is unaffected by the first.`,
          detector: "py.mutable-default-argument",
        }),
      );
    }

    return results;
  },
};

/**
 * Shell commands built from interpolated values, including the `shell=True`
 * form of `subprocess`, which routes arguments through a shell.
 */
const SHELL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/os\s*\.\s*system\s*\(/, "os.system"],
  [/os\s*\.\s*popen\s*\(/, "os.popen"],
  [/subprocess\s*\.\s*\w+\s*\([^)]*shell\s*=\s*True/, "subprocess with shell=True"],
];

const INTERPOLATION_HINT = /f["']|\$\{|%\s*\(|\+\s*[A-Za-z_]\w*|\.format\s*\(/;

export const shellCommandInterpolation: Detector = {
  id: "py.shell-command-interpolation",
  axis: "security",
  families: PYTHON_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      const code = stripHashComment(line);

      let matched: string | null = null;
      for (const [pattern, label] of SHELL_PATTERNS) {
        if (pattern.test(code)) {
          matched = label;
          break;
        }
      }
      if (matched === null) continue;
      if (!INTERPOLATION_HINT.test(code)) continue;

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "security",
          title: "Shell command is built from an interpolated value",
          problem: `The command string passed to \`${matched}\` contains an interpolated value.`,
          why: "These calls interpret shell syntax, so any metacharacter in the value is parsed as part of the command rather than as data.",
          impact: "A caller-controlled value executes arbitrary commands with the privileges of this process.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "a value containing a shell metacharacter such as `;` or `$(...)` reaches the interpolation",
            wrongResult: "the shell parses the value as syntax and runs an additional command",
          }),
          confidence: 82,
          fix: "Pass an argument list and avoid the shell: `subprocess.run([\"git\", \"log\", value], check=True)`. When a shell is unavoidable, validate the value against a strict allowlist first.",
          suggestedPatch: null,
          suggestedTest: "Add a test that passes a value containing `; id` and asserts nothing beyond the intended command ran.",
          detector: "py.shell-command-interpolation",
        }),
      );
    }

    return results;
  },
};

export const PYTHON_DETECTORS: readonly Detector[] = [
  mutableDefaultArgument,
  shellCommandInterpolation,
];
