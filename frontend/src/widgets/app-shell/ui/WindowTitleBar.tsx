import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Cancel01Icon,
  Copy01Icon,
  Maximize01Icon,
  MinusSignIcon,
  SidebarLeft01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import type { ElectronWindowControls } from "@/types/electron";

interface WindowTitleBarProps {
  controls?: ElectronWindowControls;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  onNavigateHome?: () => void;
  onOpenSettings?: () => void;
}

const BAR_HEIGHT = "h-8";

function WindowActionButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`app-no-drag flex h-8 w-9 items-center justify-center transition-colors ${
        danger ? "text-white/70 hover:bg-[#c42b1c] hover:text-white" : "text-white/60 hover:bg-white/10 hover:text-white/90"
      }`}
    >
      {children}
    </button>
  );
}

type MenuItemDef =
  | { type: "item"; label: string; shortcut?: string; onClick?: () => void; href?: string; disabled?: boolean }
  | { type: "separator" }
  | { type: "header"; label: string };

function TitleBarMenu({
  label,
  items,
  isOpen,
  anyOpen,
  onOpen,
  onClose,
}: {
  label: string;
  items: MenuItemDef[];
  isOpen: boolean;
  anyOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseEnter={() => {
          if (anyOpen && !isOpen) onOpen();
        }}
        onClick={() => (isOpen ? onClose() : onOpen())}
        data-menu-open={isOpen ? "true" : "false"}
        className={`app-no-drag rounded-[5px] px-2 py-1 text-[12.5px] font-normal leading-none transition-colors ${
          isOpen ? "bg-white/10 text-white/90" : "text-white/65 hover:bg-white/10 hover:text-white/85"
        }`}
      >
        {label}
      </button>

      {/* Premium animation container */}
      <div
        className={cn(
          "absolute left-0 top-full z-50 mt-1 grid min-w-[220px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#232323] shadow-[0_16px_40px_rgba(0,0,0,0.45)]",
          "transition-[opacity,grid-template-rows] duration-150 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="p-1">
            {items.map((item, index) => {
              if (item.type === "separator") {
                return (
                  <div
                    key={`sep-${index}`}
                    className={cn(
                      "mx-1 my-1 h-px bg-white/[0.06] transition-opacity duration-100 ease-out",
                      isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                    )}
                    style={{ transitionDelay: isOpen ? `${index * 30}ms` : "0ms" }}
                  />
                );
              }
              if (item.type === "header") {
                return (
                  <div
                    key={`hdr-${index}`}
                    className={cn(
                      "px-2 py-1 text-[11px] font-medium tracking-wide text-white/30 transition-opacity duration-100 ease-out",
                      isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                    )}
                    style={{ transitionDelay: isOpen ? `${index * 30}ms` : "0ms" }}
                  >
                    {item.label}
                  </div>
                );
              }
              const content = (
                <span className="flex w-full items-center justify-between gap-6">
                  <span className="truncate">{item.label}</span>
                  {item.shortcut && <span className="shrink-0 text-[11px] text-white/30">{item.shortcut}</span>}
                </span>
              );
              const baseClass = cn(
                "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-normal leading-none transition-opacity duration-100 ease-out",
                isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                item.disabled
                  ? "cursor-default text-white/25"
                  : "text-white/80 hover:bg-white/[0.08] hover:text-white",
              );
              // Premium staggered delay: index * 75ms as specified
              const delay = isOpen ? `${index * 75}ms` : "0ms";
              return item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className={baseClass}
                  style={{ transitionDelay: delay }}
                >
                  {content}
                </a>
              ) : (
                <button
                  key={item.label}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onClick?.();
                    onClose();
                  }}
                  className={baseClass}
                  style={{ transitionDelay: delay }}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WindowTitleBar({ controls, onToggleSidebar, isSidebarCollapsed, onNavigateHome, onOpenSettings }: WindowTitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!controls) return;
    let cancelled = false;
    void controls.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    const unsubscribe = controls.onStateChanged(({ maximized: value }) => {
      setMaximized(value);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [controls]);

  const handleToggleMaximize = useCallback(() => {
    void controls?.toggleMaximize().then((value) => {
      if (typeof value === "boolean") setMaximized(value);
    });
  }, [controls]);

  const handleUndo = useCallback(() => document.execCommand("undo"), []);
  const handleRedo = useCallback(() => document.execCommand("redo"), []);
  const handleCut = useCallback(() => document.execCommand("cut"), []);
  const handleCopy = useCallback(() => document.execCommand("copy"), []);
  const handlePaste = useCallback(() => document.execCommand("paste"), []);
  const handleSelectAll = useCallback(() => document.execCommand("selectAll"), []);

  const fileItems: MenuItemDef[] = [
    { type: "item", label: "New Review", shortcut: "Ctrl+N", onClick: onNavigateHome },
    { type: "item", label: "Open Folder…", shortcut: "Ctrl+O", onClick: onNavigateHome },
    { type: "item", label: "Open File…", shortcut: "Ctrl+Shift+O", onClick: onNavigateHome },
    { type: "separator" },
    { type: "item", label: "Close Window", shortcut: "Ctrl+W", onClick: () => void controls?.close() },
    { type: "item", label: "Quit CodeRadar", shortcut: "Ctrl+Q", onClick: () => void controls?.close() },
  ];

  const editItems: MenuItemDef[] = [
    { type: "item", label: "Undo", shortcut: "Ctrl+Z", onClick: handleUndo },
    { type: "item", label: "Redo", shortcut: "Ctrl+Y", onClick: handleRedo },
    { type: "separator" },
    { type: "item", label: "Cut", shortcut: "Ctrl+X", onClick: handleCut },
    { type: "item", label: "Copy", shortcut: "Ctrl+C", onClick: handleCopy },
    { type: "item", label: "Paste", shortcut: "Ctrl+V", onClick: handlePaste },
    { type: "item", label: "Delete", onClick: () => document.execCommand("delete") },
    { type: "separator" },
    { type: "item", label: "Select All", shortcut: "Ctrl+A", onClick: handleSelectAll },
    { type: "separator" },
    { type: "item", label: "Settings…", shortcut: "Ctrl+,", onClick: onOpenSettings },
  ];

  const viewItems: MenuItemDef[] = [
    { type: "item", label: isSidebarCollapsed ? "Show Sidebar" : "Hide Sidebar", shortcut: "Ctrl+B", onClick: onToggleSidebar },
    { type: "item", label: "Toggle Full Screen", shortcut: "F11", onClick: () => document.documentElement.requestFullscreen?.() },
    { type: "separator" },
    { type: "item", label: "Zoom In", shortcut: "Ctrl++", disabled: true },
    { type: "item", label: "Zoom Out", shortcut: "Ctrl+-", disabled: true },
    { type: "item", label: "Actual Size", shortcut: "Ctrl+0", disabled: true },
  ];

  // These point at the repository as it is actually named on GitHub. The product
  // was renamed to CodeRadar, but the remote was not, so rewriting these to the
  // new brand would turn two working links into 404s.
  const helpItems: MenuItemDef[] = [
    { type: "item", label: "GitHub Repository", href: "https://github.com/derohaze/CodeGuard-Desktop" },
    { type: "item", label: "Report an Issue", href: "https://github.com/derohaze/CodeGuard-Desktop/issues" },
    { type: "separator" },
    { type: "item", label: "About CodeRadar", onClick: onNavigateHome },
  ];

  return (
    <div className={`app-drag relative z-30 flex shrink-0 items-center justify-between bg-[#1a1a1a] ${BAR_HEIGHT}`}>
      <div className="flex min-w-0 items-center gap-0.5 pl-1.5">
        {onToggleSidebar && (
          <button
            type="button"
            aria-label={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={onToggleSidebar}
            className="app-no-drag flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white/85"
          >
            <HugeiconsIcon icon={SidebarLeft01Icon} size={16} strokeWidth={1.7} color="currentColor" />
          </button>
        )}
        <div className="ml-1 hidden items-center gap-0.5 sm:flex">
          <TitleBarMenu label="File" items={fileItems} isOpen={openMenu === "File"} anyOpen={openMenu !== null} onOpen={() => setOpenMenu("File")} onClose={() => setOpenMenu(null)} />
          <TitleBarMenu label="Edit" items={editItems} isOpen={openMenu === "Edit"} anyOpen={openMenu !== null} onOpen={() => setOpenMenu("Edit")} onClose={() => setOpenMenu(null)} />
          <TitleBarMenu label="View" items={viewItems} isOpen={openMenu === "View"} anyOpen={openMenu !== null} onOpen={() => setOpenMenu("View")} onClose={() => setOpenMenu(null)} />
          <TitleBarMenu label="Help" items={helpItems} isOpen={openMenu === "Help"} anyOpen={openMenu !== null} onOpen={() => setOpenMenu("Help")} onClose={() => setOpenMenu(null)} />
        </div>
      </div>

      {controls && (
        <div className="flex shrink-0 items-stretch">
          <WindowActionButton label="Minimize" onClick={() => void controls.minimize()}>
            <HugeiconsIcon icon={MinusSignIcon} size={14} strokeWidth={1.8} color="currentColor" />
          </WindowActionButton>
          <WindowActionButton label={maximized ? "Restore" : "Maximize"} onClick={handleToggleMaximize}>
            {maximized ? (
              <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.8} color="currentColor" />
            ) : (
              <HugeiconsIcon icon={Maximize01Icon} size={13} strokeWidth={1.8} color="currentColor" />
            )}
          </WindowActionButton>
          <WindowActionButton label="Close" danger onClick={() => void controls.close()}>
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.8} color="currentColor" />
          </WindowActionButton>
        </div>
      )}
    </div>
  );
}
