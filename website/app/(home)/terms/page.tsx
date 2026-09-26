import { LegalPage } from '@/components/layouts/legal-page';
import { termsSections } from './sections';
import { createMetadata } from '@/lib/metadata';

export const metadata = createMetadata({
  title: 'Terms of Service',
  description: 'The agreement that governs your use of the CodeRadar platform.',
  path: '/terms',
});
export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      description="The plain-language agreement between you and CodeRadar — what you can expect from us, and what we ask of you."
      lastUpdated="July 5, 2026"
      sections={termsSections}
    />
  );
}
