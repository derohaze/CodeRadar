import { Shield } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEMO_SESSIONS } from '../data';
import { label as labelClass } from '../tokens';

function IssuePill({ count }: { count: number }) {
  const clean = count === 0;
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium',
        clean
          ? 'bg-[hsl(var(--cr-success)/0.16)] text-[hsl(var(--cr-success))]'
          : 'bg-[hsl(var(--cr-high)/0.16)] text-[hsl(var(--cr-high))]',
      )}
    >
      {clean ? 'No issues' : `${count} issues`}
    </span>
  );
}

export function AppSidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        'relative h-full shrink-0 overflow-hidden transition-[width] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed ? 'w-0' : 'w-[168px] sm:w-[196px]',
      )}
      aria-hidden={collapsed}
    >
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex h-full w-[168px] flex-col overflow-hidden bg-[hsl(var(--cr-sidebar))] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] sm:w-[196px]',
          collapsed ? '-translate-x-4 opacity-0' : 'translate-x-0 opacity-100',
        )}
      >
        <div className="px-3.5 pb-1.5 pt-3.5">
          <h1 className="cr-brand text-[19px] leading-none text-[hsl(var(--cr-text-primary))]">
            CodeRadar
          </h1>
          <p className={cn(labelClass, 'mt-1.5 text-[10px] normal-case tracking-wide opacity-80')}>
            Security workspace
          </p>
        </div>

        <div className="px-2.5 py-2">
          <div className="flex w-full items-center gap-2 rounded-full bg-[hsl(var(--cr-primary))] px-3 py-1.5 text-[12px] font-medium text-[hsl(var(--cr-primary-foreground))] shadow-sm">
            <Shield className="size-3.5 shrink-0 text-[hsl(var(--cr-primary-foreground))]/70" />
            <span className="truncate">Code Review</span>
          </div>
        </div>

        <div className="flex items-center justify-between px-3.5 pb-1.5 pt-1">
          <p className={cn(labelClass, 'text-[9.5px]')}>Sessions</p>
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ul className="space-y-1">
            {DEMO_SESSIONS.map((session, index) => (
              <li key={session.id}>
                <div
                  className={cn(
                    'w-full rounded-lg px-2.5 py-2',
                    index === 0 && 'bg-[hsl(var(--cr-tile))]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold text-[hsl(var(--cr-text-primary))]">
                      {session.name}
                    </span>
                    <IssuePill count={session.issueCount} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="truncate text-[10.5px] text-[hsl(var(--cr-text-tertiary))]">
                      {session.name} · {session.time}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
