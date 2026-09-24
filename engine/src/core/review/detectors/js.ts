/**
 * JavaScript and TypeScript detectors.
 *
 * Every detector here was chosen because a type checker, the recommended ESLint
 * set, or a formatter does not catch it. Mechanical defects that lint already
 * reports are deliberately absent: repeating them would spend the reader's
 * attention and make the rest of the output look less trustworthy.
 */

import { buildEvidence, candidate, lineAt, singleLinePatch, stripComment } from "./shared.ts";
import type { Detector, DetectorInput } from "./shared.ts";

const JS_FAMILIES = ["js"] as const;

/**
 * `for (...; i <= collection.length; ...)` reads one past the end.
 *
 * The exclusion of a `- 1` on the right is what keeps this precise: `i <= len - 1`
 * is the correct form and must not be reported.
 */
const LOOP_HEADER = /\b(for|while)\s*\(/;
const INCLUSIVE_LENGTH_BOUND = /<=\s*([A-Za-z_$][\w$]*)\s*\.\s*length\b/;

export const offByOneLoopBound: Detector = {
  id: "js.off-by-one-loop-bound",
  axis: "correctness",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      if (line.includes("//")) continue;
      if (!LOOP_HEADER.test(line)) continue;

      // A loop header can span lines. Only a single-line header gets a patch,
      // but the defect is reported either way.
      let header = line;
      let headerEnd = index;
      while (!header.includes(")") && headerEnd < index + 4 && headerEnd < input.file.lines.length - 1) {
        headerEnd += 1;
        header += ` ${lineAt(input.file, headerEnd)}`;
      }

      const match = INCLUSIVE_LENGTH_BOUND.exec(header);
      if (match === null) continue;

      // `i <= arr.length - 1` is correct and must not be flagged.
      const afterMatch = header.slice(match.index + match[0].length);
      if (/^\s*-\s*1\b/.test(afterMatch)) continue;

      const singleLine = index === headerEnd;
      const patched = singleLine
        ? singleLinePatch(
            input.file.path,
            index + 1,
            line,
            line.replace(/<=\s*([A-Za-z_$][\w$]*\s*\.\s*length)/, "< $1"),
          )
        : null;

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "correctness",
          title: "Loop bound is inclusive of the collection length",
          problem: `The loop condition compares with \`<=\` against \`${match[1]}.length\`, so the final iteration uses an index equal to the length.`,
          why: "Valid indices run from 0 to length - 1. Comparing with `<=` against `length` makes the last iteration read one element past the end, which yields `undefined` rather than a value.",
          impact:
            "The final iteration reads `undefined`, so anything derived from it is wrong, and a property access on that value throws.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: `the loop runs with the index equal to \`${match[1]}.length\``,
            wrongResult: "one extra iteration reads past the end of the collection",
          }),
          confidence: 78,
          fix: `Use \`<\` instead of \`<=\`: \`for (let i = 0; i < ${match[1]}.length; i += 1)\`.`,
          suggestedPatch: patched,
          suggestedTest: `Add a test that passes an empty collection and a single-element collection and asserts the body runs 0 and 1 times respectively.`,
          detector: "js.off-by-one-loop-bound",
        }),
      );
    }

    return results;
  },
};

/**
 * `x === NaN` is always false and `x !== NaN` is always true, because NaN is
 * not equal to itself. No lint rule in the recommended set flags this.
 */
const NAN_COMPARISON = /(===|!==|==|!=)\s*NaN\b|NaN\s*(===|!==|==|!=)/;

/**
 * The same comparison, but capturing the operand so the fix can be written.
 *
 * No anchors: the comparison is usually one term of a larger expression such as
 * `return score === NaN;`, so requiring the whole line to be the comparison
 * would mean never producing a patch for the common case.
 */
const NAN_COMPARISON_SUBJECT =
  /([\w$.[\]]+)\s*(?:===|==|!==|!=)\s*NaN\b|NaN\b\s*(?:===|==|!==|!=)\s*([\w$.[\]]+)/;

export const nanComparison: Detector = {
  id: "js.nan-comparison",
  axis: "correctness",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      const code = stripComment(line);
      if (!NAN_COMPARISON.test(code)) continue;

      const negated = /(!==|!=)\s*NaN\b|NaN\s*(!==|!=)/.test(code);
      const subjectMatch = NAN_COMPARISON_SUBJECT.exec(code);
      const subject = subjectMatch?.[1] ?? subjectMatch?.[2] ?? null;

      const patched =
        subject === null
          ? null
          : singleLinePatch(
              input.file.path,
              index + 1,
              line,
              line.replace(
                NAN_COMPARISON_SUBJECT,
                (_full, left: string | undefined, right: string | undefined) => {
                  const target = left ?? right ?? "";
                  return negated ? `!Number.isNaN(${target})` : `Number.isNaN(${target})`;
                },
              ),
            );

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "correctness",
          title: "Comparison with NaN never behaves as written",
          problem: "The code compares a value against `NaN` with an equality operator.",
          why: "`NaN` is the only value that is not equal to itself, so `x === NaN` is always `false` and `x !== NaN` is always `true` regardless of `x`.",
          impact: `The branch is dead: the ${
            negated ? "guard never fails, so invalid values pass through" : "check never fires, so NaN values are treated as valid"
          }.`,
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "the value under test is NaN",
            wrongResult: `the comparison returns ${negated ? "true" : "false"} for every input, so it never distinguishes NaN`,
          }),
          confidence: 92,
          fix: `Use \`Number.isNaN(x)\` instead of comparing to \`NaN\`${negated ? ", negated with `!` for an inequality check" : ""}.`,
          suggestedPatch: patched,
          suggestedTest: "Add a test that passes NaN and a normal value and asserts the two take different branches.",
          detector: "js.nan-comparison",
        }),
      );
    }

    return results;
  },
};

/** Declarations with a numeric element type, used to make `.sort()` precise. */
const NUMERIC_ARRAY_DECLARATION =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*(?:readonly\s+)?(?:number|bigint)\s*\[\s*\]/g;
const NUMERIC_ARRAY_GENERIC = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*Array<(?:number|bigint)>/g;

/**
 * `Array.prototype.sort()` without a comparator sorts by UTF-16 code units, so
 * `[10, 9].sort()` becomes `[10, 9]` and `[100, 2]` becomes `[100, 2]`.
 *
 * The detector only fires when the file itself declares the collection as
 * numeric. Without that evidence, sorting strings without a comparator is
 * correct code and reporting it would be a false positive.
 */
export const numericSortWithoutComparator: Detector = {
  id: "js.numeric-sort-without-comparator",
  axis: "correctness",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const numericNames = new Set<string>();
    for (const pattern of [NUMERIC_ARRAY_DECLARATION, NUMERIC_ARRAY_GENERIC]) {
      pattern.lastIndex = 0;
      for (const match of input.file.content.matchAll(pattern)) {
        const name = match[1];
        if (name !== undefined) numericNames.add(name);
      }
    }

    if (numericNames.size === 0) return [];

    const results = [];
    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      const code = stripComment(line);

      for (const name of numericNames) {
        const call = new RegExp(`\\b${name}\\s*\\.\\s*sort\\s*\\(\\s*\\)`).exec(code);
        if (call === null) continue;

        results.push(
          candidate(input, {
            line: index + 1,
            lineEnd: index + 1,
            severity: "medium",
            axis: "correctness",
            title: "Numeric array is sorted lexicographically",
            problem: `\`${name}\` is declared as a numeric array but \`.sort()\` is called without a comparator.`,
            why: "With no comparator, `sort` converts every element to a string and compares UTF-16 code units, which is not numeric order. `[2, 10]` stays `[2, 10]` and `[2, 10]` is not sorted ascending numerically.",
            impact: "Any ordering the result is used for, such as pagination, ranking, or a binary search, is wrong for values with different digit counts.",
            evidence: buildEvidence({
              file: input.file.path,
              line: index + 1,
              source: line,
              trigger: `a numeric array with at least two elements of different digit counts`,
              wrongResult: "the array is ordered by string comparison instead of numeric value",
            }),
            confidence: 85,
            fix: `Pass a numeric comparator: \`${name}.sort((a, b) => a - b)\`.`,
            suggestedPatch: singleLinePatch(
              input.file.path,
              index + 1,
              line,
              line.replace(
                new RegExp(`(\\b${name}\\s*\\.\\s*sort)\\s*\\(\\s*\\)`),
                "$1((a, b) => a - b)",
              ),
            ),
            suggestedTest: `Assert \`${name}.sort((a, b) => a - b)\` on \`[10, 9, 100]\` yields \`[9, 10, 100]\` so the ordering is pinned.`,
            detector: "js.numeric-sort-without-comparator",
          }),
        );
        break;
      }
    }

    return results;
  },
};

/** Names whose literal value is a credential being assigned in source. */
const SECRET_ASSIGNMENT =
  /(?:^|[^\w.])(api[_-]?key|apikey|secret|client[_-]?secret|secret[_-]?key|password|passwd|pwd|token|auth[_-]?token|access[_-]?token|access[_-]?key|private[_-]?key|bearer)\s*[:=]\s*(["'`])([^"'`\n]{8,})\2/i;

const PLACEHOLDER_VALUES =
  /^(?:your|my|our|example|sample|placeholder|changeme|change_me|replace_me|insert|xxx+|<[^>]*>|\.{3}|test|dummy|fake|redacted|todo|none|null|undefined|n\/a|\*+)$/i;

/**
 * Recognises a literal that is shaped like a real credential rather than a
 * placeholder: real keys carry both letters and digits, or a known prefix.
 */
function looksLikeCredential(value: string): boolean {
  if (PLACEHOLDER_VALUES.test(value)) return false;
  if (value.length < 16) return false;
  if (/^(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza|ya29\.|glpat-)/.test(value)) return true;
  return /[A-Za-z]/.test(value) && /\d/.test(value);
}

/**
 * A real credential committed in source. There is no core lint rule for this,
 * and the consequence is a leaked secret that survives in git history.
 */
export const hardcodedSecret: Detector = {
  id: "js.hardcoded-secret",
  axis: "security",
  families: ["js", "python", "other"],
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      const match = SECRET_ASSIGNMENT.exec(line);
      if (match === null) continue;

      const value = match[3];
      if (value === undefined || !looksLikeCredential(value)) continue;

      const hasKnownPrefix = /^(?:sk-|ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza|ya29\.|glpat-)/.test(value);

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          // A live-looking provider key with a recognised prefix is critical;
          // everything else is a leak that still needs rotation but whose
          // blast radius cannot be established from one file.
          severity: hasKnownPrefix ? "critical" : "high",
          axis: "security",
          title: "Credential is hardcoded in source",
          problem: `A literal value is assigned to \`${match[1]}\` in the file.`,
          why: "Source is copied, forked, and cached. A credential committed here is available to everyone with read access to the repository and remains in git history after the line is removed.",
          impact: "Anyone with repository access can authenticate as this principal until the credential is rotated.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "the repository is read by anyone who should not hold this credential",
            wrongResult: `the secret assigned to \`${match[1]}\` is fully disclosed by reading this file`,
          }),
          confidence: hasKnownPrefix ? 92 : 84,
          fix: `Read \`${match[1]}\` from the environment or a secret store, fail fast when it is absent, and rotate the value that is currently in the repository.`,
          suggestedPatch: null,
          suggestedTest: "Add a startup test that asserts the application fails with a clear message when the variable is unset, so the secret can never be reintroduced as a default.",
          detector: "js.hardcoded-secret",
        }),
      );
    }

    return results;
  },
};

/** Names that imply the value must be unpredictable to be safe. */
const SECURITY_SENSITIVE_NAME = /(token|secret|nonce|salt|otp|password|passwd|apikey|api_key|session|csrf|reset|verification|signature)/i;
const WEAK_RANDOM = /Math\s*\.\s*random\s*\(/;

/**
 * `Math.random()` is not cryptographically secure. Using it to produce a value
 * that must be unguessable is a real weakness, and no core lint rule flags it.
 */
export const weakRandomSecret: Detector = {
  id: "js.weak-random-secret",
  axis: "security",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      if (!WEAK_RANDOM.test(line)) continue;

      const target = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(stripComment(line))?.[1] ?? "";
      const context = `${target} ${line}`;
      if (!SECURITY_SENSITIVE_NAME.test(context)) continue;

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "security",
          title: "Security-sensitive value uses a predictable random source",
          problem: "A value whose name implies it must be unguessable is derived from `Math.random()`.",
          why: "`Math.random()` is a fast, seed-based PRNG with no cryptographic guarantees. Its output is predictable once enough values are observed or the internal state is inferred.",
          impact: "An attacker who can predict the value can forge the token, session identifier, or reset code, which defeats the check it exists to enforce.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "an attacker observes several generated values from the same process",
            wrongResult: "subsequent values become predictable, so the secret can be guessed",
          }),
          confidence: 78,
          fix: "Use a cryptographic source: `crypto.randomUUID()` or `crypto.getRandomValues(new Uint8Array(32))` in Node and the browser, or `secrets.token_urlsafe()` in Python.",
          suggestedPatch: null,
          suggestedTest: "Assert the generated value is not derivable from a previous value, for example that 1,000 values are unique and that the generator is the crypto module.",
          detector: "js.weak-random-secret",
        }),
      );
    }

    return results;
  },
};

const TEMPLATE_INTERPOLATION = /`[^`]*\$\{/;

/**
 * A real SQL statement shape, not just a keyword.
 *
 * Matching a bare `FROM` or `WHERE` was a measured false positive: an ordinary
 * message such as "Score inputs from this run" contains `from`, so every
 * interpolated log line looked like a query. Requiring the statement structure
 * (SELECT through FROM, INSERT INTO, UPDATE with SET) is what makes this
 * precise, and precision is what the bar asks for.
 */
const SQL_STATEMENT =
  /\bSELECT\b[^`"']{0,200}?\bFROM\b|\bINSERT\s+INTO\s+[\w`"']|\bUPDATE\s+[\w`"'.\[\]]+\s+SET\b|\bDELETE\s+FROM\s+[\w`"']|\bREPLACE\s+INTO\s+[\w`"']/i;

/** `"..."` immediately followed by a concatenation of something dynamic. */
const SQL_CONCATENATION = /(["'])[^"']*\1\s*\+\s*[A-Za-z_$[(]/;

/**
 * SQL text assembled from a value instead of bound as a parameter.
 */
export const sqlStringInterpolation: Detector = {
  id: "js.sql-string-interpolation",
  axis: "security",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      if (line.includes("//")) continue;
      if (!SQL_STATEMENT.test(line)) continue;
      if (!TEMPLATE_INTERPOLATION.test(line) && !SQL_CONCATENATION.test(line)) continue;

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "security",
          title: "SQL statement is built by string interpolation",
          problem: "A query string is assembled with interpolated or concatenated values rather than bound parameters.",
          why: "Interpolated values become part of the statement text, so any metacharacter in the value is parsed as SQL. Escaping by hand cannot be relied on across drivers and encodings.",
          impact: "A caller-controlled value can change the query's structure, which allows reading or destroying data the caller was never entitled to.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "a value containing a quote or a SQL clause reaches this interpolation",
            wrongResult: "the value is parsed as SQL and the statement executes with attacker-chosen structure",
          }),
          confidence: 80,
          fix: "Use bound parameters for every value and keep the statement text constant, for example `db.query('select * from users where id = ?', [id])`.",
          suggestedPatch: null,
          suggestedTest: "Add a test that passes a value containing a quote and asserts it is treated as data, for example that no row is returned and no error surfaces.",
          detector: "js.sql-string-interpolation",
        }),
      );
    }

    return results;
  },
};

const INNER_HTML_ASSIGNMENT = /\.innerHTML\s*=\s*(.+)$/;
const DANGEROUS_HTML = /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*(.+?)\s*\}\}/;
const SANITISER_CALL = /(sanitiz|purif|escape|encode|DOMPurify|textContent|createTextNode)/i;

function isStaticLiteral(expression: string): boolean {
  const trimmed = expression.trim().replace(/;\s*$/, "");
  // A template literal with interpolation is dynamic, not static. Treating
  // `` `<p>${value}</p>` `` as static would hide the exact case this detector
  // exists to catch, so the check is on the absence of interpolation.
  if (trimmed.startsWith("`")) return !trimmed.includes("${");
  return /^(["'])/.test(trimmed);
}

/**
 * Markup assigned from a value, with no sanitiser on the path.
 */
export const htmlInjection: Detector = {
  id: "js.html-injection",
  axis: "security",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      if (line.includes("//")) continue;

      const assignment = INNER_HTML_ASSIGNMENT.exec(line)?.[1] ?? DANGEROUS_HTML.exec(line)?.[1] ?? null;
      if (assignment === null) continue;
      if (isStaticLiteral(assignment)) continue;
      if (SANITISER_CALL.test(assignment)) continue;

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "security",
          title: "Markup is assigned from an unsanitised value",
          problem: "A value is written into the DOM as HTML without a sanitiser in the expression.",
          why: "`innerHTML` and `dangerouslySetInnerHTML` parse their input as markup. Any value that reaches them can introduce elements and event handlers the author did not write.",
          impact: "A value that carries script markup executes in the context of this page, which can read session material and act as the signed-in user.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "the assigned value contains markup such as an image tag with an error handler",
            wrongResult: "the markup is parsed and its handler executes in the page context",
          }),
          confidence: 74,
          fix: "Assign text with `textContent`, or render the value through the framework's normal escaping path. When HTML is genuinely required, pass it through a maintained sanitiser first.",
          suggestedPatch: null,
          suggestedTest: "Add a test that assigns a value containing a script tag and asserts no element was created from it.",
          detector: "js.html-injection",
        }),
      );
    }

    return results;
  },
};

const SHELL_EXEC_INTERPOLATION = /(?:exec|execSync)\s*\(\s*`[^`]*\$\{/;
const SHELL_EXEC_CONCATENATION = /(?:exec|execSync|spawnSync)\s*\(\s*["'][^"']*["']\s*\+/;

/**
 * A shell command string built from a value.
 */
export const shellCommandInterpolation: Detector = {
  id: "js.shell-command-interpolation",
  axis: "security",
  families: JS_FAMILIES,
  run(input: DetectorInput) {
    const results = [];

    for (let index = 0; index < input.file.lines.length; index += 1) {
      const line = lineAt(input.file, index);
      if (line.includes("//")) continue;
      if (!SHELL_EXEC_INTERPOLATION.test(line) && !SHELL_EXEC_CONCATENATION.test(line)) continue;

      results.push(
        candidate(input, {
          line: index + 1,
          lineEnd: index + 1,
          severity: "high",
          axis: "security",
          title: "Shell command is built from an interpolated value",
          problem: "A command string passed to `exec` contains an interpolated or concatenated value.",
          why: "The argument is handed to a shell, so shell metacharacters in the value are interpreted as syntax. A value containing a semicolon or a command substitution appends or replaces the intended command.",
          impact: "A caller-controlled value executes arbitrary commands with the privileges of this process.",
          evidence: buildEvidence({
            file: input.file.path,
            line: index + 1,
            source: line,
            trigger: "a value containing a shell metacharacter reaches the interpolation",
            wrongResult: "the shell parses the value as syntax and runs an additional command",
          }),
          confidence: 86,
          fix: "Call the program directly with an argument array, for example `execFile('git', ['log', value])`, which removes the shell from the path entirely.",
          suggestedPatch: null,
          suggestedTest: "Add a test that passes a value containing `; id` and asserts nothing beyond the intended command ran.",
          detector: "js.shell-command-interpolation",
        }),
      );
    }

    return results;
  },
};

export const JS_DETECTORS: readonly Detector[] = [
  offByOneLoopBound,
  nanComparison,
  numericSortWithoutComparator,
  hardcodedSecret,
  weakRandomSecret,
  sqlStringInterpolation,
  htmlInjection,
  shellCommandInterpolation,
];
