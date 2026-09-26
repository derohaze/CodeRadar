'use client';

import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
  Navbar,
  NavbarLogo,
  NavBody,
  NavItems,
} from '@/components/ui/resizable-navbar';
import { cn } from '@/lib/cn';

const navItems = [
  {
    name: 'Features',
    link: '/features',
  },
  {
    name: 'Docs',
    link: '/docs',
  },
  {
    name: 'Blog',
    link: '/blog',
  },
];

const repoUrl = 'https://github.com/derohaze/CodeGuard';

function GithubButton({ className }: { className?: string }) {
  return (
    <a
      href={repoUrl}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="CodeRadar on GitHub"
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full bg-neutral-950 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
      GitHub
    </a>
  );
}

function ThemeModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';
  const isLight = mounted && resolvedTheme === 'light';

  return (
    <div className="inline-flex h-9 items-center rounded-full border bg-white p-1 shadow-sm dark:bg-neutral-950">
      <button
        type="button"
        aria-label="Switch to light mode"
        aria-pressed={isLight}
        onClick={() => setTheme('light')}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          isLight && 'bg-neutral-100 text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-100',
        )}
      >
        <Sun className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Switch to dark mode"
        aria-pressed={isDark}
        onClick={() => setTheme('dark')}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          isDark && 'bg-neutral-100 text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-100',
        )}
      >
        <Moon className="size-4" />
      </button>
    </div>
  );
}

export function ResizableHomeHeader({ className }: ComponentProps<'header'>) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header id="nd-nav" className={cn('h-14', className)}>
      <Navbar>
        <NavBody>
          <NavbarLogo />
          <NavItems items={navItems} />
          <div className="relative z-20 flex items-center gap-4">
            <GithubButton />
            <ThemeModeToggle />
          </div>
        </NavBody>

        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo />
            <div className="flex items-center gap-3">
              <GithubButton />
              <ThemeModeToggle />
              <MobileNavToggle
                isOpen={isMobileMenuOpen}
                onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
              />
            </div>
          </MobileNavHeader>

          <MobileNavMenu isOpen={isMobileMenuOpen}>
            {navItems.map((item) => (
              <a
                key={item.link}
                href={item.link}
                onClick={() => setIsMobileMenuOpen(false)}
                className="relative text-neutral-600 dark:text-neutral-300"
              >
                <span className="block">{item.name}</span>
              </a>
            ))}
          </MobileNavMenu>
        </MobileNav>
      </Navbar>
    </header>
  );
}
