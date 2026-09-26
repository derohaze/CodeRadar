'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, PanelLeft, Square, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { repoUrl, issuesUrl } from '@/lib/github';

type MenuItem =
  | { type: 'item'; label: string; shortcut?: string; href?: string; disabled?: boolean }
  | { type: 'separator' };

const MENUS: Record<string, MenuItem[]> = {
  File: [
    { type: 'item', label: 'New Review', shortcut: 'Ctrl+N' },
    { type: 'item', label: 'Open Folder…', shortcut: 'Ctrl+O' },
    { type: 'item', label: 'Open File…', shortcut: 'Ctrl+Shift+O' },
    { type: 'separator' },
    { type: 'item', label: 'Close Window', shortcut: 'Ctrl+W' },
    { type: 'item', label: 'Quit CodeRadar', shortcut: 'Ctrl+Q' },
  ],
  Edit: [
    { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z' },
    { type: 'item', label: 'Redo', shortcut: 'Ctrl+Y' },
    { type: 'separator' },
    { type: 'item', label: 'Cut', shortcut: 'Ctrl+X' },
    { type: 'item', label: 'Copy', shortcut: 'Ctrl+C' },
    { type: 'item', label: 'Paste', shortcut: 'Ctrl+V' },
  ],
  View: [
    { type: 'item', label: 'Hide Sidebar', shortcut: 'Ctrl+B' },
    { type: 'item', label: 'Toggle Full Screen', shortcut: 'F11' },
    { type: 'separator' },
    { type: 'item', label: 'Zoom In', shortcut: 'Ctrl++', disabled: true },
    { type: 'item', label: 'Zoom Out', shortcut: 'Ctrl+-', disabled: true },
    { type: 'item', label: 'Actual Size', shortcut: 'Ctrl+0', disabled: true },
  ],
  Help: [
    { type: 'item', label: 'GitHub Repository', href: repoUrl },
    { type: 'item', label: 'Report an Issue', href: issuesUrl },
    { type: 'separator' },
    { type: 'item', label: 'About CodeRadar' },
  ],
};

function TitleBarMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'rounded-[5px] px-2 py-1 text-[12.5px] font-normal leading-none transition-colors',
          open
            ? 'bg-white/10 text-white/90'
            : 'text-white/65 hover:bg-white/10 hover:text-white/85',
        )}
      >
        {name}
      </button>

      <div
        className={cn(
          'absolute left-0 top-full z-50 mt-1 grid min-w-[220px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#232323] shadow-[0_16px_40px_rgba(0,0,0,0.45)] transition-[opacity,grid-template-rows] duration-150 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="p-1">
            {MENUS[name].map((item, index) =>
              item.type === 'separator' ? (
                <div key={`sep-${index}`} className="mx-1 my-1 h-px bg-white/[0.06]" />
              ) : item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-[12.5px] font-normal leading-none text-white/80 hover:bg-white/[0.08] hover:text-white"
                >
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-normal leading-none',
                    item.disabled
                      ? 'cursor-default text-white/25'
                      : 'text-white/80 hover:bg-white/[0.08] hover:text-white',
                  )}
                >
                  <span className="truncate">{item.label}</span>
                  {item.shortcut && <span className="shrink-0 text-[11px] text-white/30">{item.shortcut}</span>}
                </button>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WindowButton({
  label,
  children,
  danger = false,
}: {
  label: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        'flex h-7 w-8 items-center justify-center',
        danger
          ? 'text-white/70 hover:bg-[#c42b1c] hover:text-white'
          : 'text-white/60 hover:bg-white/10 hover:text-white/90',
      )}
    >
      {children}
    </span>
  );
}

export function AppTitleBar({
  onToggleSidebar,
  sidebarCollapsed,
}: {
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between bg-[#1a1a1a]">
      <div className="flex min-w-0 items-center gap-0.5 pl-1.5">
        <button
          type="button"
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={onToggleSidebar}
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white/85"
        >
          <PanelLeft className="size-3.5" />
        </button>
        <div className="ml-1 hidden items-center gap-0.5 sm:flex">
          {Object.keys(MENUS).map((name) => (
            <TitleBarMenu key={name} name={name} />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-stretch">
        <WindowButton label="Minimize">
          <Minus className="size-3.5" />
        </WindowButton>
        <WindowButton label="Maximize">
          <Square className="size-3" />
        </WindowButton>
        <WindowButton label="Close" danger>
          <X className="size-3.5" />
        </WindowButton>
      </div>
    </div>
  );
}
