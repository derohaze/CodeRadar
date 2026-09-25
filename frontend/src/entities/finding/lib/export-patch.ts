import type { Finding, PatchExportSnapshot, RemediationActionResult } from "@/entities/finding/model/types";

export interface PatchExportBundle {
  patchFileName: string;
  summaryFileName: string;
  patchText: string;
  summaryText: string;
}

export function buildPatchExportBundle({
  finding,
  action,
  snapshot,
}: {
  finding: Finding;
  action: RemediationActionResult;
  snapshot: PatchExportSnapshot;
}): PatchExportBundle {
  const fileLabel = basename(snapshot.file);
  const findingSlug = slugify(finding.title || finding.category || fileLabel || "remediation");
  const verificationLabel = action.verificationStatus === "verified"
    ? "Deterministic verification passed"
    : action.verificationStatus === "manual_review_required"
      ? "Manual review required after workspace apply"
      : "Verification pending";
  const strategyLabel = snapshot.strategyLabel ?? (snapshot.manualEdit ? "Manual edit" : "Unnamed strategy");
  const patchText = snapshot.diff.endsWith("\n") ? snapshot.diff : `${snapshot.diff}\n`;
  const summaryLines = [
    "CodeRadar Export Summary",
    "",
    `Finding: ${finding.title}`,
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
    `File: ${snapshot.file}`,
    `Strategy: ${strategyLabel}`,
    `Fix type: ${snapshot.fixType.replace("_", " ")}`,
    `Mode: ${snapshot.mode}`,
    `Manual edit applied: ${snapshot.manualEdit ? "yes" : "no"}`,
    `Verification: ${verificationLabel}`,
    `Approval gate: ${action.approvalGateOutcome}`,
    `Approval reason: ${action.approvalGateReason}`,
    `Write scope: ${action.writeScope}`,
    `Network policy: ${action.networkPolicy}`,
    "",
    "Patch summary",
    snapshot.summary || "No patch summary was captured.",
    "",
    "Patch rationale",
    snapshot.rationale || "No patch rationale was captured.",
  ];

  if (snapshot.residualRisks.length) {
    summaryLines.push("", "Residual risks");
    snapshot.residualRisks.forEach((entry, index) => {
      summaryLines.push(`${index + 1}. ${entry}`);
    });
  }

  if (action.verificationNotes.length) {
    summaryLines.push("", "Verification notes");
    action.verificationNotes.forEach((entry, index) => {
      summaryLines.push(`${index + 1}. ${entry}`);
    });
  }

  return {
    patchFileName: `${findingSlug}.patch`,
    summaryFileName: `${findingSlug}-summary.txt`,
    patchText,
    summaryText: `${summaryLines.join("\n")}\n`,
  };
}

export function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function basename(file: string) {
  const parts = file.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? file;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "remediation";
}
