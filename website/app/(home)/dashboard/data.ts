import type { PillTone } from './tokens';
import type { DemoNavItem, DemoNavSection } from './types';
import type { ThinkingOrbState } from '@/components/thinking-orb';

/* ------------------------- page labels ------------------------- */

export type DemoPageKey =
  | 'setup'
  | 'review'
  | 'findings'
  | 'detail'
  | 'providers'
  | 'overview'
  | 'reports'
  | 'analytics'
  | 'seo'
  | 'aeo'
  | 'geo'
  | 'products'
  | 'orders'
  | 'customers'
  | 'shipping'
  | 'team'
  | 'integrations';

export const demoPageLabels: Record<DemoPageKey, string> = {
  setup: 'Review setup',
  review: 'Live review',
  findings: 'Findings',
  detail: 'Finding detail',
  providers: 'Providers',
  overview: 'Overview',
  reports: 'Reports',
  analytics: 'Analytics',
  seo: 'SEO',
  aeo: 'AEO',
  geo: 'GEO',
  products: 'Products',
  orders: 'Orders',
  customers: 'Customers',
  shipping: 'Shipping',
  team: 'Team & Permissions',
  integrations: 'Integrations',
};

/* ------------------------ nav sections ------------------------- */

export const demoNavSections: DemoNavSection[] = [
  {
    label: 'Review',
    items: [
      { key: 'setup', label: 'Setup', icon: 'Home01Icon' },
      { key: 'review', label: 'Live review', icon: 'Activity01Icon' },
      { key: 'findings', label: 'Findings', icon: 'SecurityCheckIcon' },
    ],
  },
  {
    label: 'Inspect',
    items: [{ key: 'detail', label: 'Finding detail', icon: 'File01Icon' }],
  },
  {
    label: 'Configure',
    items: [{ key: 'providers', label: 'Providers', icon: 'Plug01Icon' }],
  },
  {
    label: 'Overview',
    items: [{ key: 'overview', label: 'Overview', icon: 'Home01Icon' }],
  },
  {
    label: 'Performance',
    items: [
      { key: 'reports', label: 'Reports', icon: 'File01Icon' },
      { key: 'analytics', label: 'Analytics', icon: 'ChartBarBigIcon' },
      { key: 'seo', label: 'SEO', icon: 'ChartBarBigIcon' },
      { key: 'aeo', label: 'AEO', icon: 'Activity01Icon' },
      { key: 'geo', label: 'GEO', icon: 'Location01Icon' },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { key: 'products', label: 'Products', icon: 'Package01Icon' },
      { key: 'orders', label: 'Orders', icon: 'ShoppingBag01Icon' },
      { key: 'customers', label: 'Customers', icon: 'UserGroupIcon' },
    ],
  },
  {
    label: 'Operations',
    items: [{ key: 'shipping', label: 'Shipping', icon: 'ShippingTruck01Icon' }],
  },
  {
    label: 'Management',
    items: [
      { key: 'team', label: 'Team & Permissions', icon: 'UserSettings01Icon' },
      { key: 'integrations', label: 'Integrations', icon: 'Plug01Icon' },
    ],
  },
];

export const demoNavItems = demoNavSections.flatMap((section) => section.items);

/* ---------------------- review phases → orb states ----------------------- */
/* Mirrors frontend ScanProgressScreen: each live phase maps to the orb
   animation that matches the kind of work in flight. */

export interface DemoPhase {
  name: string;
  orb: ThinkingOrbState;
  detail: string;
}

export const demoPhases: DemoPhase[] = [
  { name: 'Discovery', orb: 'working', detail: '48/52 files indexed' },
  { name: 'Repository mapping', orb: 'searching', detail: '12/12 mapping artifacts ready' },
  { name: 'Segmentation', orb: 'shaping', detail: '31/34 files segmented' },
  { name: 'Path tracing', orb: 'composing', detail: '9/11 paths prepared' },
  { name: 'Reviewing paths', orb: 'solving', detail: '14/18 blocks reviewed' },
  { name: 'Validation', orb: 'solving', detail: '4/5 candidates validated' },
  { name: 'Scoring', orb: 'listening', detail: '3/3 score artifacts finalized' },
];

/* ---------------------- findings ----------------------- */

export type DemoSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface DemoFinding {
  id: string;
  title: string;
  file: string;
  range: string;
  severity: DemoSeverity;
  confidence: number;
  category: string;
  summary: string;
  impact: string;
  evidence: string;
  fix: string;
}

export const severityTone: Record<DemoSeverity, PillTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
};

export const demoFindings: DemoFinding[] = [
  {
    id: 'f1',
    title: 'Unsanitized path join allows directory traversal',
    file: 'engine/src/adapters/fs.ts',
    range: '41-47',
    severity: 'critical',
    confidence: 92,
    category: 'Path traversal',
    summary: 'User-controlled segment is joined to the workspace root without normalization or containment check.',
    impact: 'A crafted source path escapes the workspace and reads arbitrary files on the reviewing machine.',
    evidence: 'join(workspaceRoot, userSegment)',
    fix: 'Resolve the joined path and reject it unless it starts with the workspace root plus separator.',
  },
  {
    id: 'f2',
    title: 'Auth token logged in clear text',
    file: 'engine/src/node/serve.ts',
    range: '88-91',
    severity: 'high',
    confidence: 88,
    category: 'Secret exposure',
    summary: 'The per-launch API token is written to the request log on startup failure.',
    impact: 'Anyone with log access can replay data routes against the local API.',
    evidence: 'log.info(`token ${apiToken}`)',
    fix: 'Log the token presence and length only; never the value.',
  },
  {
    id: 'f3',
    title: 'Unbounded glob walks node_modules',
    file: 'engine/src/core/discovery.ts',
    range: '112-118',
    severity: 'medium',
    confidence: 81,
    category: 'Performance',
    summary: 'Discovery has no ignore list for dependency directories before the walk starts.',
    impact: 'Large checkouts scan 10x files, blowing review time and context budgets.',
    evidence: 'walk(dir) // no ignore',
    fix: 'Seed the walker with default ignores (node_modules, dist, .git) before traversal.',
  },
  {
    id: 'f4',
    title: 'Missing origin check on local API route',
    file: 'engine/src/node/routes.ts',
    range: '203-207',
    severity: 'low',
    confidence: 74,
    category: 'CSRF hardening',
    summary: 'One read-only route skips the Origin allow-list the other routes enforce.',
    impact: 'A malicious page could probe review state cross-origin on machines without token rotation.',
    evidence: '// TODO: origin check',
    fix: 'Route the handler through the shared origin-guard middleware.',
  },
];

export const droppedCandidates = [
  { title: 'Possible XSS in finding title render', reason: 'evidence-mismatch — quoted markup is not in the named file' },
  { title: 'Weak hash in replay store', reason: 'policy-rejected — below the confidence bar at 41%' },
];

/* ---------------------- order data ----------------------- */

export interface DemoOrderItem {
  name: string;
  quantity: number;
  price: string;
}

export interface DemoTimelineEvent {
  label: string;
  time: string;
  done: boolean;
}

export interface DemoOrder {
  code: string;
  product: string;
  customer: string;
  phone: string;
  governorate: string;
  city: string;
  address: string;
  date: string;
  total: string;
  subtotal: string;
  shippingFee: string;
  payment: string;
  status: string;
  tone: PillTone;
  items: DemoOrderItem[];
  timeline: DemoTimelineEvent[];
}

export const demoOrders: DemoOrder[] = [
  {
    code: '#EF-1861', product: 'Leather Crossbody Bag', customer: 'Salma Adel', phone: '+20 100 ••• 4821',
    governorate: 'Cairo', city: 'Nasr City', address: '14 Abbas El Akkad St., Apt 7',
    date: 'Jul 4, 11:20', total: '1,450', subtotal: '1,395', shippingFee: '55', payment: 'COD',
    status: 'Confirmed', tone: 'success',
    items: [{ name: 'Leather Crossbody Bag — Tan', quantity: 1, price: '1,395' }],
    timeline: [
      { label: 'Order placed', time: 'Jul 4, 11:20', done: true },
      { label: 'Anti-spam check passed', time: 'Jul 4, 11:21', done: true },
      { label: 'Confirmed by Mona', time: 'Jul 4, 11:34', done: true },
      { label: 'Awaiting pickup', time: '—', done: false },
    ],
  },
  {
    code: '#EF-1858', product: 'Ceramic Mug Set (4pc)', customer: 'Ahmed Hassan', phone: '+20 111 ••• 0932',
    governorate: 'Giza', city: 'Dokki', address: '3 Tahrir St., Floor 5',
    date: 'Jul 4, 10:52', total: '620', subtotal: '570', shippingFee: '50', payment: 'Card',
    status: 'Pending', tone: 'progress',
    items: [{ name: 'Ceramic Mug Set (4pc) — Sand', quantity: 1, price: '570' }],
    timeline: [
      { label: 'Order placed', time: 'Jul 4, 10:52', done: true },
      { label: 'Anti-spam check passed', time: 'Jul 4, 10:53', done: true },
      { label: 'Confirmation call', time: 'In queue', done: false },
    ],
  },
  {
    code: '#EF-1854', product: 'Linen Summer Shirt', customer: 'Omar Farouk', phone: '+20 122 ••• 5518',
    governorate: 'Cairo', city: 'Maadi', address: '22 Road 9, Villa 4',
    date: 'Jul 4, 09:47', total: '890', subtotal: '830', shippingFee: '60', payment: 'COD',
    status: 'Shipped', tone: 'neutral',
    items: [
      { name: 'Linen Summer Shirt — White / L', quantity: 1, price: '490' },
      { name: 'Linen Summer Shirt — Navy / L', quantity: 1, price: '340' },
    ],
    timeline: [
      { label: 'Order placed', time: 'Jul 4, 09:47', done: true },
      { label: 'Confirmed by Karim', time: 'Jul 4, 10:02', done: true },
      { label: 'Picked up by Bosta', time: 'Jul 4, 13:15', done: true },
      { label: 'Out for delivery', time: '—', done: false },
    ],
  },
  {
    code: '#EF-1849', product: 'Scented Candle Trio', customer: 'Nour ElSayed', phone: '+20 106 ••• 2210',
    governorate: 'Alexandria', city: 'Smouha', address: '8 Fawzi Moaz St.',
    date: 'Jul 3, 18:31', total: '540', subtotal: '475', shippingFee: '65', payment: 'Wallet',
    status: 'Delivered', tone: 'success',
    items: [{ name: 'Scented Candle Trio — Amber', quantity: 1, price: '475' }],
    timeline: [
      { label: 'Order placed', time: 'Jul 3, 18:31', done: true },
      { label: 'Confirmed by Mona', time: 'Jul 3, 18:50', done: true },
      { label: 'Picked up by Mylerz', time: 'Jul 4, 09:10', done: true },
      { label: 'Delivered', time: 'Jul 4, 15:42', done: true },
    ],
  },
  {
    code: '#EF-1846', product: 'Canvas Tote — Olive', customer: 'Mariam Khaled', phone: '+20 109 ••• 3308',
    governorate: 'Cairo', city: 'Heliopolis', address: '31 El Hegaz St., Apt 12',
    date: 'Jul 3, 16:05', total: '380', subtotal: '330', shippingFee: '50', payment: 'COD',
    status: 'Follow-Up', tone: 'warning',
    items: [{ name: 'Canvas Tote — Olive', quantity: 1, price: '330' }],
    timeline: [
      { label: 'Order placed', time: 'Jul 3, 16:05', done: true },
      { label: 'No answer (1st attempt)', time: 'Jul 3, 17:20', done: true },
      { label: 'Follow-up scheduled', time: 'Jul 5, 12:00', done: false },
    ],
  },
  {
    code: '#EF-1840', product: 'Desk Organizer Walnut', customer: 'Youssef Nabil', phone: '+20 128 ••• 7754',
    governorate: 'Dakahlia', city: 'Mansoura', address: '5 Gomhouria St.',
    date: 'Jul 3, 12:14', total: '1,120', subtotal: '1,050', shippingFee: '70', payment: 'Card',
    status: 'Delivered', tone: 'success',
    items: [{ name: 'Desk Organizer — Walnut', quantity: 1, price: '1,050' }],
    timeline: [
      { label: 'Order placed', time: 'Jul 3, 12:14', done: true },
      { label: 'Confirmed by Karim', time: 'Jul 3, 12:30', done: true },
      { label: 'Delivered', time: 'Jul 4, 14:05', done: true },
    ],
  },
  {
    code: '#EF-1833', product: 'Cotton Throw Blanket', customer: 'Hana Mostafa', phone: '+20 101 ••• 6642',
    governorate: 'Giza', city: '6th of October', address: 'District 7, Building 14',
    date: 'Jul 2, 20:40', total: '760', subtotal: '700', shippingFee: '60', payment: 'COD',
    status: 'Cancelled', tone: 'danger',
    items: [{ name: 'Cotton Throw Blanket — Grey', quantity: 1, price: '700' }],
    timeline: [
      { label: 'Order placed', time: 'Jul 2, 20:40', done: true },
      { label: 'Customer requested cancel', time: 'Jul 3, 09:12', done: true },
      { label: 'Cancelled by Mona', time: 'Jul 3, 09:15', done: true },
    ],
  },
];

/* --------------------- products data ---------------------- */

export const demoProducts = [
  { name: 'Leather Crossbody Bag', sku: 'BG-114', price: '1,450', stock: 42, status: 'Active', tone: 'success' as PillTone },
  { name: 'Linen Summer Shirt', sku: 'AP-231', price: '890', stock: 18, status: 'Active', tone: 'success' as PillTone },
  { name: 'Ceramic Mug Set (4pc)', sku: 'HM-078', price: '620', stock: 6, status: 'Low stock', tone: 'warning' as PillTone },
  { name: 'Scented Candle Trio', sku: 'HM-102', price: '540', stock: 64, status: 'Active', tone: 'success' as PillTone },
  { name: 'Canvas Tote — Olive', sku: 'BG-097', price: '380', stock: 0, status: 'Out of stock', tone: 'danger' as PillTone },
];

/* -------------------- customers data ---------------------- */

export const demoCustomers = [
  { name: 'Salma Adel', phone: '+20 100 ••• 4821', governorate: 'Cairo', orders: 9, spent: '8,940' },
  { name: 'Ahmed Hassan', phone: '+20 111 ••• 0932', governorate: 'Giza', orders: 4, spent: '3,120' },
  { name: 'Nour ElSayed', phone: '+20 106 ••• 2210', governorate: 'Alexandria', orders: 7, spent: '5,480' },
  { name: 'Youssef Nabil', phone: '+20 128 ••• 7754', governorate: 'Mansoura', orders: 2, spent: '1,760' },
  { name: 'Mariam Khaled', phone: '+20 109 ••• 3308', governorate: 'Cairo', orders: 5, spent: '4,215' },
];

/* -------------------- workspaces data --------------------- */

export const demoWorkspaces = [
  { name: 'Cairo Store', role: 'Owner workspace' },
  { name: 'Alex Outlet', role: 'Owner workspace' },
  { name: 'Giza Warehouse', role: 'Operations workspace' },
];

/* ------------------ notifications data -------------------- */

export const demoNotifications = [
  { icon: 'ShoppingBag01Icon' as const, title: 'New order #EF-1861', detail: 'Salma Adel · 1,450 · Cairo', time: '2m ago' },
  { icon: 'Package01Icon' as const, title: 'Low stock warning', detail: 'Ceramic Mug Set (4pc) — 6 left', time: '26m ago' },
  { icon: 'DeliveryTruck01Icon' as const, title: 'Shipment picked up', detail: '#EF-1854 with Bosta', time: '1h ago' },
];

/* -------------------- revenue trend ----------------------- */

export const demoRevenueTrend = [
  { label: 'Jan', revenue: 312, orders: 640 },
  { label: 'Feb', revenue: 358, orders: 720 },
  { label: 'Mar', revenue: 341, orders: 690 },
  { label: 'Apr', revenue: 402, orders: 810 },
  { label: 'May', revenue: 445, orders: 902 },
  { label: 'Jun', revenue: 489, orders: 1120 },
  { label: 'Jul', revenue: 529, orders: 1284 },
];

/* ------------------- traffic sources ---------------------- */

export const demoTrafficSources = [
  { label: 'Facebook Ads', share: 42, detail: '1,433 sessions' },
  { label: 'Instagram', share: 27, detail: '921 sessions' },
  { label: 'Organic search', share: 18, detail: '614 sessions' },
  { label: 'Direct', share: 9, detail: '307 sessions' },
  { label: 'TikTok', share: 4, detail: '137 sessions' },
];

/* ------------------- pulse metrics ------------------------ */

export const demoPulseMetrics = [
  { label: 'New customers', value: '187', detail: '19.4% of customers', accent: '+12%' },
  { label: 'Repeat customers', value: '642', detail: '18.8% repeat rate', accent: '+4%' },
  { label: 'Orders / customer', value: '1.4', detail: '1,284 tracked orders', accent: '87%' },
  { label: 'Delivered orders', value: '1,118', detail: '87.1% delivery rate', accent: '+6%' },
  { label: 'Returned orders', value: '44', detail: '3.4% return rate', accent: '-1%' },
  { label: 'Cancelled orders', value: '86', detail: '6.7% cancel rate', accent: '-3%' },
];

/* -------------------- top products ------------------------ */

export const demoTopProducts = [
  { name: 'Leather Crossbody Bag', orders: 186, units: 211, revenue: '269K' },
  { name: 'Linen Summer Shirt', orders: 154, units: 228, revenue: '137K' },
  { name: 'Ceramic Mug Set (4pc)', orders: 121, units: 136, revenue: '75K' },
  { name: 'Scented Candle Trio', orders: 98, units: 104, revenue: '53K' },
];

/* ---------------- platform performance -------------------- */

export const demoPlatformPerformance = [
  { label: 'Facebook Ads', orders: 512, share: 40, delivery: 88, value: '219K', icon: 'Megaphone01Icon' as const },
  { label: 'Instagram', orders: 328, share: 26, delivery: 84, value: '141K', icon: 'Activity01Icon' as const },
  { label: 'Shopify', orders: 241, share: 19, delivery: 91, value: '103K', icon: 'StoreLocation01Icon' as const },
  { label: 'Organic', orders: 203, share: 15, delivery: 86, value: '66K', icon: 'ChartBarBigIcon' as const },
];

/* ----------------- operational rows ----------------------- */

export const demoOperationalRows = [
  { label: 'Delivered', value: 1118, percent: 87, icon: 'CheckmarkCircle02Icon' as const },
  { label: 'Cancelled', value: 86, percent: 7, icon: 'Cancel01Icon' as const },
  { label: 'Returned', value: 44, percent: 3, icon: 'DeliveryTruck01Icon' as const },
];

/* ------------------- search audits ------------------------ */

export const demoSearchAudits = [
  { url: 'https://example.com/products/leather-crossbody-bag', time: 'Today, 11:24', score: 86 },
  { url: 'https://example.com/collections/summer', time: 'Yesterday, 18:10', score: 74 },
  { url: 'https://example.com/blog/care-guide', time: 'Jun 30, 09:42', score: 91 },
];

/* -------------------- seo / aeo / geo --------------------- */

export const demoSeoChecks = [
  { label: 'Title & meta description', value: 'Healthy', tone: 'success' as PillTone },
  { label: 'Core Web Vitals', value: 'Needs image compression', tone: 'warning' as PillTone },
  { label: 'Robots & sitemap', value: 'Indexed', tone: 'success' as PillTone },
  { label: 'Internal links', value: '14 crawlable links', tone: 'neutral' as PillTone },
];

export const demoAeoChecks = [
  { label: 'Answer summary', value: 'Clear product answer available', tone: 'success' as PillTone },
  { label: 'FAQ schema', value: '3 questions detected', tone: 'success' as PillTone },
  { label: 'Entity coverage', value: 'Brand, product, price', tone: 'neutral' as PillTone },
  { label: 'JSON-LD issues', value: 'Missing aggregateRating', tone: 'warning' as PillTone },
];

export const demoGeoChecks = [
  { label: 'Generative summary', value: 'Readable commerce intent', tone: 'success' as PillTone },
  { label: 'Claims found', value: '8 verifiable claims', tone: 'neutral' as PillTone },
  { label: 'Definition clarity', value: '2 definitions need context', tone: 'warning' as PillTone },
  { label: 'Citation readiness', value: 'Strong source snippets', tone: 'success' as PillTone },
];

/* -------------------- shipments --------------------------- */

export const demoShipments = [
  { code: '#EF-1854', courier: 'Bosta', destination: 'Maadi, Cairo', status: 'In Transit', tone: 'neutral' as PillTone },
  { code: '#EF-1852', courier: 'Mylerz', destination: 'Smouha, Alexandria', status: 'Out for Delivery', tone: 'neutral' as PillTone },
  { code: '#EF-1849', courier: 'Mylerz', destination: 'Smouha, Alexandria', status: 'Delivered', tone: 'success' as PillTone },
  { code: '#EF-1845', courier: 'Bosta', destination: 'Dokki, Giza', status: 'Exception', tone: 'danger' as PillTone },
  { code: '#EF-1840', courier: 'Aramex', destination: 'Mansoura, Dakahlia', status: 'Delivered', tone: 'success' as PillTone },
];

/* ----------------------- team ----------------------------- */

export const demoTeam = [
  { name: 'Omar Sherif', role: 'Owner', status: 'Active', tone: 'success' as PillTone, initials: 'OS' },
  { name: 'Mona Tarek', role: 'Order agent', status: 'Active', tone: 'success' as PillTone, initials: 'MT' },
  { name: 'Karim Adel', role: 'Order agent', status: 'Active', tone: 'success' as PillTone, initials: 'KA' },
  { name: 'Laila Samir', role: 'Media buyer', status: 'Active', tone: 'success' as PillTone, initials: 'LS' },
  { name: 'Hassan Omar', role: 'Fulfillment', status: 'Invited', tone: 'warning' as PillTone, initials: 'HO' },
];

/* -------------------- integrations ------------------------ */

export const demoIntegrations = [
  { name: 'Shopify', detail: 'Orders & products sync', status: 'Connected', tone: 'success' as PillTone, icon: 'StoreLocation01Icon' as const },
  { name: 'Meta Ads', detail: 'Campaign spend & ROAS', status: 'Connected', tone: 'success' as PillTone, icon: 'Megaphone01Icon' as const },
  { name: 'Bosta', detail: 'Shipping & tracking events', status: 'Connected', tone: 'success' as PillTone, icon: 'DeliveryTruck01Icon' as const },
  { name: 'Mailchimp', detail: 'Customer campaigns', status: 'Not connected', tone: 'neutral' as PillTone, icon: 'Mail01Icon' as const },
];

/* ------------------- order filters ------------------------ */

export const orderFilters = ['All', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'] as const;
