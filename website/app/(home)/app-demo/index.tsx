'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';
import { DEMO_LOG_PREFIX, DEMO_PHASES, DEMO_RUN_MS } from './data';
import { AppSidebar } from './shell/sidebar';
import { AppTitleBar } from './shell/title-bar';
import { LiveReviewScreen } from './screens/live-review';
import { appRoot } from './tokens';

const TICK_MS = 100;
/** Hold the finished state briefly before the loop restarts. */
const LOOP_HOLD_MS = 1200;

/** Where in the scripted run the clock currently is. */
function locatePhase(elapsed: number) {
  let remaining = elapsed;
  for (let index = 0; index < DEMO_PHASES.length; index += 1) {
    const phase = DEMO_PHASES[index];
    if (remaining < phase.ms) {
      return { phaseIndex: index, phaseProgress: (remaining / phase.ms) * 100 };
    }
    remaining -= phase.ms;
  }
  return { phaseIndex: DEMO_PHASES.length - 1, phaseProgress: 100 };
}

export function AppDemo() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => setMounted(true), []);

  const theme: 'light' | 'dark' = mounted && resolvedTheme === 'light' ? 'light' : 'dark';

  // The review animation loops forever — it is the only thing that moves in the demo.
  useEffect(() => {
    const id = window.setInterval(
      () => setElapsed((value) => (value + TICK_MS) % (DEMO_RUN_MS + LOOP_HOLD_MS)),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const { phaseIndex, phaseProgress } = useMemo(() => locatePhase(elapsed), [elapsed]);
  const overallProgress = Math.min(100, (elapsed / DEMO_RUN_MS) * 100);
  const phase = DEMO_PHASES[Math.min(phaseIndex, DEMO_PHASES.length - 1)];
  const visibleLog = useMemo(
    () => [...DEMO_LOG_PREFIX, ...DEMO_PHASES.slice(0, phaseIndex + 1).map((item) => item.log)],
    [phaseIndex],
  );

  return (
    <div className="w-full">
      <div className={cn(appRoot, 'overflow-hidden rounded-xl border border-[hsl(var(--cr-border))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]')} data-theme={theme}>
        <AppTitleBar
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          sidebarCollapsed={sidebarCollapsed}
        />

        <div className="flex h-[520px] w-full overflow-hidden sm:h-[560px] lg:h-[600px]">
          <AppSidebar collapsed={sidebarCollapsed} />

          <main className="flex min-w-0 flex-1 flex-col bg-[hsl(var(--cr-surface))]">
            <LiveReviewScreen
              orbState={phase.orb}
              phaseIndex={phaseIndex}
              phaseProgress={phaseProgress}
              overallProgress={overallProgress}
              counters={phase.counter}
              visibleLog={visibleLog}
              currentLine={phase.log}
              elapsedSeconds={Math.round(elapsed / 1000)}
              onStop={() => setElapsed(0)}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
