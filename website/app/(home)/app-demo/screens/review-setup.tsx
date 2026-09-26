'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, File as FileIcon, Folder, Play, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEMO_PRESETS, DEMO_RECENT_SOURCES } from '../data';
import { card, field, label, mono, muted, tile } from '../tokens';

function Select({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
        className={cn(field, 'flex w-full items-center justify-between gap-2 text-left')}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-card))] p-1 shadow-[0_16px_32px_rgba(0,0,0,0.35)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors',
                option.value === value
                  ? 'bg-[hsl(var(--cr-primary))] font-medium text-[hsl(var(--cr-primary-foreground))]'
                  : 'text-[hsl(var(--cr-text-secondary))] hover:bg-[hsl(var(--cr-muted))]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReviewSetupScreen({
  onRun,
  workspace,
}: {
  onRun: () => void;
  workspace: string;
}) {
  const [preset, setPreset] = useState('balanced');
  const [mode, setMode] = useState('deep');
  const [targetType, setTargetType] = useState<'folder' | 'file'>('folder');
  const [targetPath, setTargetPath] = useState('');

  const selectedPreset = DEMO_PRESETS.find((item) => item.id === preset) ?? DEMO_PRESETS[1];
  const ready = targetPath.length > 0;

  return (
    <div className="hide-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4">
        <div>
          <div className={cn(label, 'flex items-center gap-1.5')}>
            <Search className="size-3 opacity-60" />
            Review setup
          </div>
          <h2 className="mt-2 text-[20px] font-semibold leading-none tracking-[-0.02em] text-[hsl(var(--cr-text-primary))]">
            Start a code review
          </h2>
          <p className={cn('mt-1.5 text-[12px] leading-5', muted)}>
            Pick a folder or file, choose a preset, and run the review
          </p>
        </div>

        <div className={cn(card, 'p-3.5')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className={cn(label, 'text-[10.5px] normal-case tracking-normal')}>Workspace</p>
              <div className={cn(field, 'mt-1.5 flex items-center')}>
                <span className="truncate">{workspace}</span>
              </div>
            </div>
            <div>
              <p className={cn(label, 'text-[10.5px] normal-case tracking-normal')}>Preset</p>
              <Select
                className="mt-1.5"
                value={preset}
                onChange={setPreset}
                options={DEMO_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
              />
              <p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-[hsl(var(--cr-text-tertiary))]">
                {selectedPreset.description}
              </p>
            </div>
          </div>

          <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
            <div>
              <p className={cn(label, 'text-[10.5px] normal-case tracking-normal')}>Review mode</p>
              <Select
                className="mt-1.5"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'deep', label: 'Deep review' },
                  { value: 'fast', label: 'Fast review' },
                ]}
              />
            </div>
            <div>
              <p className={cn(label, 'text-[10.5px] normal-case tracking-normal')}>Target</p>
              <div className="relative mt-1.5 inline-flex rounded-full border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-tile))] p-0.5">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-[hsl(var(--cr-primary))] shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
                  style={{
                    transform: targetType === 'folder' ? 'translateX(0)' : 'translateX(calc(100% + 4px))',
                  }}
                />
                {(
                  [
                    { id: 'folder', labelText: 'Folder', Icon: Folder },
                    { id: 'file', labelText: 'File', Icon: FileIcon },
                  ] as const
                ).map((option) => {
                  const active = targetType === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setTargetType(option.id);
                        setTargetPath('');
                      }}
                      className={cn(
                        'relative z-10 inline-flex min-w-[74px] items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-500',
                        active ? 'text-[hsl(var(--cr-primary-foreground))]' : 'text-[hsl(var(--cr-text-secondary))] hover:text-[hsl(var(--cr-text-primary))]',
                      )}
                    >
                      <option.Icon className="size-3" />
                      {option.labelText}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTargetPath(workspace)}
                className="inline-flex h-8 w-[124px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[hsl(var(--cr-primary))] px-3 text-[12px] font-medium text-[hsl(var(--cr-primary-foreground))] shadow-sm transition-opacity hover:opacity-90"
              >
                {targetType === 'folder' ? <Folder className="size-3" /> : <FileIcon className="size-3" />}
                {targetType === 'folder' ? 'Choose folder' : 'Choose file'}
              </button>
              <span className="truncate text-[11.5px] text-[hsl(var(--cr-text-tertiary))]">
                {targetPath ? targetPath.split('/').pop() : 'No source selected yet'}
              </span>
            </div>
            <div className={cn(tile, 'mt-2 flex items-center gap-2 px-3 py-2')}>
              <span className={cn(label, 'text-[9.5px]')}>Path</span>
              <span className={cn(mono, 'truncate text-[hsl(var(--cr-text-secondary))]')}>
                {targetPath || 'No source selected'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onRun}
            disabled={!ready}
            className={cn(
              'mt-3.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--cr-primary))] px-4 text-[12.5px] font-medium text-[hsl(var(--cr-primary-foreground))] transition-opacity',
              ready ? 'hover:opacity-90' : 'cursor-not-allowed opacity-45',
            )}
          >
            <Play className="size-3.5" />
            {ready ? 'Run review' : 'Choose a source first'}
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <span className={cn(label, 'shrink-0 text-[9.5px]')}>Recent</span>
          <div className="flex gap-1.5">
            {DEMO_RECENT_SOURCES.map((source) => (
              <button
                key={source.path}
                type="button"
                onClick={() => setTargetPath(source.path)}
                title={source.path}
                className="inline-flex max-w-[130px] shrink-0 items-center gap-1.5 truncate rounded-full border border-[hsl(var(--cr-border))] bg-[hsl(var(--cr-card))] px-2.5 py-1 text-[11px] text-[hsl(var(--cr-text-secondary))] transition-colors hover:bg-[hsl(var(--cr-tile))]"
              >
                <span className="truncate">{source.name}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTargetPath('')}
            className="ml-auto shrink-0 text-[10.5px] text-[hsl(var(--cr-text-tertiary))] hover:text-[hsl(var(--cr-text-secondary))]"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
