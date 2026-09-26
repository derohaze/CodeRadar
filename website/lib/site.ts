export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://coderadar.dev').replace(/\/$/, '');

export const repoUrl = 'https://github.com/derohaze/CodeGuard';

export const siteConfig = {
  name: 'CodeRadar',
  url: siteUrl,
  title: 'CodeRadar | Local-first code review that proves every finding',
  description:
    'CodeRadar is an open-source, local-first code review desktop app. Point it at a file or folder and it reports the defects it can prove — each with quoted evidence, consequence if it ships, and a concrete fix.',
  socialImage: '/banner.png',
  keywords: [
    'code review tool',
    'open source code review',
    'local-first code review',
    'AI code review',
    'static analysis',
    'code security scanner',
    'deterministic detectors',
    'evidence-gated findings',
    'Electron code review app',
    'TypeScript review engine',
  ],
} as const;
