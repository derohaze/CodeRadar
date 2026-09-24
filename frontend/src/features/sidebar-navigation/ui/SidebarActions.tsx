import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppScreen } from "@/shared/types/app";

export function SidebarActions({
  currentScreen,
  onNavigate,
}: {
  currentScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
}) {
  const isScanActive = currentScreen === "home" || currentScreen === "scan-empty";

  return (
    <div className="space-y-0.5 px-3 py-2">
      <button
        onClick={() => onNavigate("home")}
        className={`flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isScanActive ? "bg-white font-medium text-black shadow-sm" : "text-txt-primary hover:bg-muted"
        }`}
      >
        <HugeiconsIcon icon={Shield01Icon} size={14} strokeWidth={1.7} color="currentColor" className={`transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isScanActive ? "text-black/70" : "text-txt-secondary"}`} />
        <span className="transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">Code Review</span>
      </button>
    </div>
  );
}
