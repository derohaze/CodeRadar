import type { CSSProperties } from "react";
import type { Session } from "@/entities/session/model/types";
import { useResolvedTheme } from "@/shared/lib/use-resolved-theme";
import type { AppScreen } from "@/shared/types/app";
import { SidebarActions } from "./SidebarActions";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSessionsList } from "./SidebarSessionsList";

interface SidebarProps {
  sessions: Session[];
  sessionOrder: string[];
  currentScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  activeSessionId?: string | null;
  onOpenSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
  onDeleteAllSessions: () => void;
  onReorderSessions: (orderedSessionIds: string[]) => void;
  isCollapsed: boolean;
  onOpenSettings: () => void;
}

export function Sidebar({
  sessions,
  sessionOrder,
  currentScreen,
  onNavigate,
  activeSessionId,
  onOpenSession,
  onDeleteSession,
  onDeleteAllSessions,
  onReorderSessions,
  isCollapsed,
  onOpenSettings,
}: SidebarProps) {
  const theme = useResolvedTheme();
  const isLight = theme === "light";
  const tokens = (isLight
    ? {
        "--text-primary": "0 0% 15%",
        "--text-secondary": "0 0% 42%",
        "--text-tertiary": "0 0% 50%",
        "--text-placeholder": "0 0% 55%",
        "--border-soft": "0 0% 88%",
        "--border-primary": "0 0% 84%",
        "--muted": "0 0% 95%",
        "--secondary": "0 0% 95%",
        "--card": "0 0% 100%",
        "--surface": "0 0% 100%",
        "--surface-secondary": "0 0% 96%",
        "--surface-sidebar": "40 22% 97%",
      }
    : {
        "--text-primary": "0 0% 92%",
        "--text-secondary": "0 0% 68%",
        "--text-tertiary": "0 0% 52%",
        "--text-placeholder": "0 0% 45%",
        "--border-soft": "0 0% 24%",
        "--border-primary": "0 0% 28%",
        "--muted": "0 0% 21%",
        "--secondary": "0 0% 21%",
        "--card": "0 0% 20%",
        "--surface": "0 0% 16%",
        "--surface-secondary": "0 0% 18%",
        "--surface-sidebar": "0 0% 10%",
      }) as CSSProperties;

  return (
    <div
      className="relative h-full shrink-0 overflow-hidden transition-[width] duration-500 ease-smooth"
      style={{ width: isCollapsed ? 0 : 300 }}
      aria-hidden={isCollapsed}
    >
      <aside
        className="absolute inset-y-0 left-0 flex w-[300px] min-h-0 flex-col overflow-hidden bg-surface-sidebar transition-[transform,opacity] duration-500 ease-smooth will-change-transform"
        style={{
          ...tokens,
          transform: isCollapsed ? "translateX(-16px)" : "translateX(0)",
          opacity: isCollapsed ? 0 : 1,
        }}
      >
        <SidebarHeader />
        <SidebarActions currentScreen={currentScreen} onNavigate={onNavigate} />
        <SidebarSessionsList
          sessions={sessions}
          sessionOrder={sessionOrder}
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
          onDeleteSession={onDeleteSession}
          onDeleteAllSessions={onDeleteAllSessions}
          onReorderSessions={onReorderSessions}
        />
        <SidebarFooter onOpenSettings={onOpenSettings} />
      </aside>
    </div>
  );
}
