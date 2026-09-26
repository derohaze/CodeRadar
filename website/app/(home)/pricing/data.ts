export type BillingCycle = 'monthly' | 'yearly';

export type PricingPlan = {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  intro: string;
  buttonLabel: string;
  features: string[];
};

export type FaqItem = {
  question: string;
  answer: string;
};

export const plans: PricingPlan[] = [
  {
    name: 'Basic',
    monthlyPrice: 0,
    yearlyPrice: 0,
    intro: 'Includes:',
    buttonLabel: 'Get Basic',
    features: [
      '1 workspace',
      '1 store',
      '50 orders / store / month',
      'Store and ads integrations',
      'Basic customer timeline',
      'Manual product imports',
    ],
  },
  {
    name: 'Starter',
    monthlyPrice: 19,
    yearlyPrice: 15,
    intro: 'Everything in Basic, plus:',
    buttonLabel: 'Get Starter',
    features: [
      '1 workspace',
      '1 store',
      '750 orders / store / month',
      'Spam and risk checks',
      'Shipping integration',
      'Invoice templates',
      'Order notifications',
      'Basic analytics reports',
    ],
  },
  {
    name: 'Pro',
    monthlyPrice: 49,
    yearlyPrice: 39,
    intro: 'Everything in Starter, plus:',
    buttonLabel: 'Get Pro',
    features: [
      '1 workspace',
      '1 store',
      '3,000 orders / store / month',
      'Product import queues',
      'Customer segmentation',
      'Anti-spam review tools',
      'Shipping package templates',
      'Email templates',
      'SEO audit jobs',
      'Activity log history',
    ],
  },
  {
    name: 'Max',
    monthlyPrice: 99,
    yearlyPrice: 79,
    intro: 'Everything in Pro, plus:',
    buttonLabel: 'Get Max',
    features: [
      '1 workspace',
      '3 stores',
      '10,000 orders / store / month',
      'Advanced anti-spam bot',
      'SEO, GEO, and AEO audits',
      'Automated report jobs',
      'Analytics snapshots',
      'Meta ads insights',
      'Realtime team workspace',
      'Ticket workflows',
    ],
  },
  {
    name: 'Ultra',
    monthlyPrice: 199,
    yearlyPrice: 159,
    intro: 'Everything in Max, plus:',
    buttonLabel: 'Get Ultra',
    features: [
      '1 workspace',
      '5 stores',
      '25,000 orders / store / month',
      'Priority risk materialization',
      'Advanced analytics accuracy',
      'Report download links',
      'Email delivery tracking',
      'Admin controls',
      'Priority workflow support',
    ],
  },
];

export const faqItems: FaqItem[] = [
  {
    question: 'What plan should I start with?',
    answer:
      'Start with Basic if you are testing one workspace and one store. Starter is for a live store taking regular orders, and Pro is the first serious operations plan.',
  },
  {
    question: 'How do order limits work?',
    answer:
      'Order limits are per store per month. Every plan gets one workspace; paid plans increase store capacity and order volume instead of changing the core integration model.',
  },
  {
    question: 'Do all plans support store and ads integrations?',
    answer:
      'Yes. Store and ads integrations are normal platform capabilities. Free/Basic does not include shipping, while paid plans add shipping workflows.',
  },
  {
    question: 'Which plans include anti-spam protection?',
    answer:
      'Starter includes basic spam and risk checks. Pro adds review tooling. Max and Ultra include the advanced anti-spam bot and deeper risk workflows.',
  },
  {
    question: 'Where do SEO, GEO, and AEO fit?',
    answer:
      'SEO starts in Pro. Max adds the full SEO, GEO, and AEO audit set for teams that need discovery and answer-engine visibility work.',
  },
  {
    question: 'Do reports and emails run automatically?',
    answer:
      'Max adds automated report jobs and email templates. Ultra adds delivery tracking and report download links for more operational control.',
  },
  {
    question: 'Can these packages change later?',
    answer:
      'Yes. We may update packaging over time, and existing customers will receive advance notice before any plan change affects their account.',
  },
];
