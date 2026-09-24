import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CircleAlert, Gauge, ShieldCheck, ShieldX, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Finding } from "@/entities/finding/model/types";
import { buildFindingDecisionSummary } from "@/entities/finding/lib/decision-center";
import { getRemediationStatusLabel, getRemediationStatusTone } from "@/entities/finding/lib/remediation-status";
import { toAnalystCopy } from "@/shared/lib/analyst-copy";
import { CopyButton } from "@/shared/ui/CopyButton";

interface Props {
  finding: Finding;
  onDismiss: () => void;
  onSuggestFix: () => void;
}

export function FindingDetailPanel({ finding, onDismiss, onSuggestFix }: Props) {
  const [loading, setLoading] = useState(false);

  const remediationStatusTone = getRemediationStatusTone(finding.remediationStatus);
  const decisionSummary = useMemo(() => buildFindingDecisionSummary(finding), [finding]);

  const recommendedFix = finding.fixSuggestions.find((entry) => entry.profile === "recommended") ?? finding.fixSuggestions[0];
  const fixPrompt = buildFixPrompt(finding);

  const handleSuggestFix = () => {
    setLoading(true);
    setTimeout(() => {
      onSuggestFix();
    }, 500);
  };

  return (
    <motion.div
      initial={{ opacity: 1, y: 0 }}
      className="hide-scrollbar flex-1 overflow-y-auto bg-surface"
    >
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-txt-primary">{finding.title}</h2>
            <p className="mt-2 text-sm font-mono text-txt-tertiary">
              {finding.file}:{finding.line}{finding.lineEnd > finding.line ? `-${finding.lineEnd}` : ""}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] ${
                  remediationStatusTone === "success"
                    ? "bg-[#f4f4f5] text-status-success"
                    : remediationStatusTone === "progress"
                      ? "bg-[#f4efe6] text-status-progress"
                      : remediationStatusTone === "warning"
                        ? "bg-[#fff6ef] text-status-high"
                        : remediationStatusTone === "muted"
                          ? "bg-[#eeeeee] text-txt-secondary"
                          : "bg-[#f4f4f5] text-txt-secondary"
                }`}
              >
                {getRemediationStatusLabel(finding.remediationStatus)}
              </span>
              <span className="inline-flex rounded-full bg-[#f0f0f0] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-txt-secondary">
                {finding.severity} risk
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <button
              onClick={() => void handleSuggestFix()}
              disabled={loading}
              className="rounded-lg border bg-card px-4 py-2 text-sm font-medium text-txt-primary transition-colors hover:bg-muted disabled:opacity-50"
              style={{ borderColor: "hsl(var(--border-primary))" }}
            >
              {loading ? "Preparing fix..." : "Create fix"}
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-[20px] border bg-card px-5 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Gauge size={16} className="text-txt-secondary" />
              <p className="text-sm font-medium text-txt-primary">AI confidence</p>
            </div>
            <span className="text-sm font-semibold text-txt-primary">{finding.confidence}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5e5e5]">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${finding.confidence}%` }} />
          </div>
          <p className="mt-3 text-xs leading-5 text-txt-tertiary">
            {finding.confidence >= 90
              ? "High confidence — the trigger and the wrong result are both grounded in the supplied code"
              : finding.confidence >= 70
                ? "Moderate confidence — the mechanism is quoted but the runtime state could not be fully verified"
                : "Reviewer confidence — verify against the actual runtime state before applying the fix"}
          </p>
        </div>


        <Tabs defaultValue="summary">
          <TabsList className="mb-6 h-auto rounded-2xl bg-[#f4ede4] p-1">
            <TabsTrigger value="summary" className="rounded-xl px-4 py-2 text-sm">Summary</TabsTrigger>
            <TabsTrigger value="decision" className="rounded-xl px-4 py-2 text-sm">Decision</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-0">
            <div className="space-y-4">
              <Panel>
                <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-txt-tertiary">What is wrong</p>
                    <p className="mt-2 text-[13px] leading-6 text-txt-secondary">{finding.summary}</p>
                  </div>
                  <div className="grid gap-2">
                    <StoryMiniCard icon={CircleAlert} label="Why it matters" value={finding.impact} tone="danger" />
                    <StoryMiniCard icon={ShieldX} label="Root cause" value={finding.explanation} />
                  </div>
                </div>
                <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                  <InfoCard label="Severity" value={finding.severity} />
                  <InfoCard label="Category" value={finding.category} />
                  <InfoCard label="Location" value={`${finding.file}:${finding.line}${finding.lineEnd > finding.line ? `-${finding.lineEnd}` : ""}`} mono />
                  <InfoCard label="Evidence" value={finding.evidence} mono />
                </div>
              </Panel>

              <Panel>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-txt-primary">Attack path</p>
                  <span className="text-xs text-txt-tertiary">Entry point to impact</span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <StoryStep step="1" title="Entry point" text={finding.attackSimulation.input} />
                  <StoryStep step="2" title="Unsafe execution" text={finding.attackSimulation.execution} tone="warning" />
                  <StoryStep step="3" title="Impact" text={finding.attackSimulation.result} tone="danger" />
                </div>
              </Panel>

              {recommendedFix && (
                <Panel>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-txt-primary">Recommended fix</p>
                      <p className="mt-1 text-xs text-txt-tertiary">Copy to Codex / Claude / Cursor</p>
                    </div>
                    <CopyButton value={fixPrompt} label="Copy fix prompt" />
                  </div>
                  <p className="text-[13px] leading-6 text-txt-secondary">{recommendedFix.description}</p>
                  <pre className="mt-3 max-h-[220px] overflow-auto rounded-lg bg-[#0f0f0f] p-3 text-[11px] leading-5 text-white/80">{fixPrompt}</pre>
                </Panel>
              )}
            </div>
          </TabsContent>

          <TabsContent value="decision" className="mt-0">
            <div className="space-y-4">
              <Panel>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-txt-primary">Decision center</p>
                  <span className="text-xs text-txt-tertiary">Recommended path forward</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <StoryMiniCard icon={ShieldCheck} label={decisionSummary.validationLabel} value={decisionSummary.validationNote} />
                  <StoryMiniCard icon={Gauge} label={`Risk score ${decisionSummary.riskScore}/100`} value={decisionSummary.riskLabel} tone={decisionSummary.riskScore >= 85 ? "danger" : "warning"} />
                  <StoryMiniCard icon={Zap} label="Recommended action" value={decisionSummary.recommendedAction} tone="warning" />
                  <StoryMiniCard icon={ShieldX} label="Approval path" value={decisionSummary.approvalPath} tone="danger" />
                </div>
              </Panel>

              <Panel>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-txt-primary">Why CodeGuard recommends a fix</p>
                  <span className="text-xs text-txt-tertiary">Security-specific guidance</span>
                </div>
                <div className="space-y-3">
                  <ExplainRow label="Fix strategy" value={decisionSummary.fixRecommendation} />
                  {decisionSummary.riskFactors.map((factor, index) => (
                    <ExplainRow key={`${factor}-${index}`} label={`Factor ${index + 1}`} value={factor} tone={index === 2 ? "danger" : "default"} />
                  ))}
                </div>
              </Panel>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-8 flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: "hsl(var(--border-primary))" }}>
          <button
            onClick={onDismiss}
            disabled={loading}
            className="rounded-lg border bg-card px-5 py-2 text-sm font-medium text-txt-primary transition-colors hover:bg-muted disabled:opacity-50"
            style={{ borderColor: "hsl(var(--border-primary))" }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function buildFixPrompt(finding: Finding): string {
  const head = `${finding.file}:${finding.line}${finding.lineEnd > finding.line ? `-${finding.lineEnd}` : ""} [${finding.severity}] ${finding.title}`;
  const fix = finding.fixSuggestions.find((entry) => entry.profile === "recommended") ?? finding.fixSuggestions[0];
  return [
    `Fix this code-review finding:`,
    ``,
    `Location: ${finding.file}:${finding.line}`,
    `Severity: ${finding.severity} (confidence ${finding.confidence}%)`,
    `Finding: ${finding.title}`,
    `What is wrong: ${toAnalystCopy(finding.summary)}`,
    `Why it matters: ${toAnalystCopy(finding.impact)}`,
    `Evidence: ${toAnalystCopy(finding.evidence)}`,
    `Recommended fix: ${fix ? toAnalystCopy(fix.description) : "Review the code and apply a minimal, behavior-preserving fix"}`,
    ``,
    `Instructions for the agent:`,
    `- Apply a minimal fix that resolves the defect without changing intended behavior`,
    `- Preserve existing tests and add coverage for the patched path`,
    `- Keep the change scoped to this finding; do not refactor unrelated code`,
    `- If the fix changes public signatures or return shapes, update callers`,
  ].join("\n");
}

function StoryMiniCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone === "danger" ? "bg-[#fff7f5]" : "bg-[#f7f7f7]"}`} style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="flex items-center gap-2 text-txt-secondary">
        <Icon size={14} className={tone === "danger" ? "text-status-critical" : tone === "warning" ? "text-status-high" : "text-txt-secondary"} />
        <p className="text-[11px] uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      </div>
      <p className="mt-2 text-[13px] leading-6 text-txt-primary [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function StoryStep({
  step,
  title,
  text,
  tone = "default",
}: {
  step: string;
  title: string;
  text: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className={`min-w-0 rounded-2xl border px-4 py-4 ${tone === "danger" ? "bg-[#fff7f5]" : tone === "warning" ? "bg-[#f7f7f7]" : "bg-card"}`} style={{ borderColor: "hsl(var(--border-soft))" }}>
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f4f4f5] text-[11px] font-semibold text-txt-primary">
          {step}
        </div>
        <p className="text-sm font-medium text-txt-primary">{title}</p>
      </div>
      <p className="mt-3 min-w-0 break-words text-[13px] leading-6 text-txt-secondary [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

function ExplainRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="grid min-w-0 gap-2 rounded-2xl border bg-[#f7f7f7] px-4 py-3 md:grid-cols-[110px_minmax(0,1fr)]" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-txt-tertiary">{label}</p>
      <p className={`min-w-0 break-words text-[13px] leading-6 [overflow-wrap:anywhere] ${tone === "danger" ? "text-status-critical" : "text-txt-secondary"}`}>{value}</p>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border bg-card px-4 py-4" style={{ borderColor: "hsl(var(--border-soft))" }}>
      {children}
    </div>
  );
}

function InfoCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-[#f7f7f7] px-4 py-3" style={{ borderColor: "hsl(var(--border-soft))" }}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-txt-tertiary">{label}</p>
      <p className={`mt-1.5 min-w-0 max-w-full overflow-hidden break-words text-[13px] leading-6 text-txt-primary ${mono ? "font-mono [overflow-wrap:anywhere]" : "[overflow-wrap:anywhere]"}`}>
        {value}
      </p>
    </div>
  );
}
