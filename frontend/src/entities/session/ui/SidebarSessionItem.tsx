import { useState } from "react";
import { AlertCircle, Clock3, Ellipsis, GitPullRequest, Trash2, TriangleAlert } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { getSessionLifecycleSummary } from "@/entities/session/lib/session-lifecycle";
import type { Session } from "@/entities/session/model/types";
import { toAnalystCopy } from "@/shared/lib/analyst-copy";
import { Loader } from "@/shared/ui/Loader";

interface Props {
  session: Session;
  index: number;
  isActive?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

export function SidebarSessionItem({ session, index, isActive = false, onClick, onDelete }: Props) {
  const [isHovered, setIsHovered] = useState(false);

  const statusConfig =
    session.status === "queued"
      ? { label: "Queued", className: "text-txt-tertiary", icon: Clock3 }
      : session.status === "scanning"
        ? { label: "Analyzing", className: "text-status-progress", icon: "loader" as const }
        : session.status === "failed"
          ? { label: "Failed", className: "text-status-critical", icon: AlertCircle }
          : { label: "Completed", className: "text-status-success", icon: GitPullRequest };
  const displayTitle = toAnalystCopy(session.title);
  const displayPreview = toAnalystCopy(session.preview);
  const surfacedCount = session.findingsCount + session.candidateFindingsCount;
  const issueLabel = surfacedCount === 0
    ? "No issues"
    : `${surfacedCount} issue${surfacedCount === 1 ? "" : "s"}`;
  const lifecycleSummary = getSessionLifecycleSummary(session);
  const lifecycleClassName =
    lifecycleSummary?.tone === "warning"
      ? "text-status-high"
      : lifecycleSummary?.tone === "progress"
        ? "text-status-progress"
        : lifecycleSummary?.tone === "success"
          ? "text-status-success"
          : "text-txt-tertiary";

  return (
    <HoverCard open={isHovered} openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <div
          onClick={onClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClick?.();
            }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={isActive}
          className={`group relative w-full rounded-xl px-3 py-2.5 text-left transition-colors ${isActive ? "bg-muted" : "hover:bg-muted"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 pr-2 text-sm font-medium leading-snug text-txt-primary">{displayTitle}</p>
            <div className="mt-0.5 flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-lg p-1 text-txt-tertiary opacity-0 transition-opacity hover:bg-card hover:text-txt-primary group-hover:opacity-100 data-[state=open]:opacity-100"
                    aria-label="Session actions"
                  >
                    <Ellipsis size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="rounded-xl border border-border-soft bg-surface p-1 text-txt-primary shadow-[0_16px_36px_rgba(0,0,0,0.1)]"
                >
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.();
                    }}
                    className="rounded-lg text-status-critical focus:bg-[#fff7f5] focus:text-status-critical"
                  >
                    <Trash2 size={14} className="mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className={`inline-flex items-center gap-1 text-[10px] ${statusConfig.className}`}>
                {statusConfig.icon === "loader" ? <Loader variant="spin" className="size-3 text-status-progress" /> : <statusConfig.icon size={12} strokeWidth={1.8} />}
              </span>
            </div>
          </div>

          <div className="mt-1 flex items-center gap-1 text-[11px] text-txt-tertiary">
            <span className="min-w-0 truncate">{session.repo}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{session.time}</span>
            <span className="ml-auto whitespace-nowrap text-txt-tertiary">{issueLabel}</span>
          </div>
          {lifecycleSummary && (
            <p className={`mt-1 truncate text-[11px] font-medium ${lifecycleClassName}`}>
              {lifecycleSummary.label}
            </p>
          )}
        </div>
      </HoverCardTrigger>

      <HoverCardContent side="right" align="start" sideOffset={12} avoidCollisions={false} className="pointer-events-none z-30 w-[270px] rounded-[18px] border border-border-soft bg-surface p-4 shadow-[0_18px_40px_rgba(0,0,0,0.12)]">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug text-txt-primary">{displayTitle}</p>
              <p className="mt-1 text-xs text-txt-tertiary">{session.repo} · {session.time}</p>
            </div>
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${statusConfig.className}`}>
              {statusConfig.icon === "loader" ? <Loader variant="spin" className="size-3.5 text-status-progress" /> : <statusConfig.icon size={13} strokeWidth={1.8} />}
              {statusConfig.label}
            </span>
          </div>

          <p className="text-[13px] leading-6 text-txt-secondary">{displayPreview}</p>
          {lifecycleSummary && (
            <p className={`text-[12px] font-medium ${lifecycleClassName}`}>
              {lifecycleSummary.label}
            </p>
          )}

          <div className="flex items-center gap-3 text-[12px]">
            <span className="inline-flex items-center gap-1 text-status-critical">
              <AlertCircle size={13} strokeWidth={1.8} />
              {session.criticalCount} critical
            </span>
            <span className="inline-flex items-center gap-1 text-status-high">
              <TriangleAlert size={13} strokeWidth={1.8} />
              {session.warningCount} warning
            </span>
            {session.candidateFindingsCount > 0 && (
              <span className="inline-flex items-center gap-1 text-txt-secondary">
                <TriangleAlert size={13} strokeWidth={1.8} />
                {session.candidateFindingsCount} candidate
              </span>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
