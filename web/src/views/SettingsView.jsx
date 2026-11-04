import { ChartIcon, CardIcon, GridIcon, ReceiptIcon, ShieldIcon } from '../components/Icons.jsx';

export const SETTINGS_TABS = [
  { id: 'overview', label: 'Overview', icon: <GridIcon /> },
  { id: 'usage', label: 'Usage and limits', icon: <ChartIcon /> },
  { id: 'plans', label: 'Plans', icon: <CardIcon /> },
  { id: 'billing', label: 'Billing', icon: <ReceiptIcon /> },
  { id: 'account', label: 'Account', icon: <ShieldIcon /> },
];

/**
 * The account area that used to be five sidebar entries. Each tab renders an existing
 * screen unchanged; the shell passes them in so this file owns only the navigation.
 *
 * @param {{ tab: string, onTabChange: (id: string) => void, panels: Record<string, import('react').ReactNode> }} props
 */
export default function SettingsView({ tab, onTabChange, panels }) {
  const current = SETTINGS_TABS.some((item) => item.id === tab) ? tab : 'overview';
  return (
    <section className="flex w-full flex-col gap-4 md:grid md:grid-cols-[210px_minmax(0,1fr)] md:items-start md:gap-6" aria-label="Settings">
      <div className="min-w-0 md:col-span-2">
        <h1 className="font-display text-2xl font-extrabold">Settings</h1>
      </div>
      {/* A scroller on phones so five tabs never wrap or push the page sideways. */}
      <nav
        aria-label="Settings sections"
        className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] md:flex-col md:overflow-visible"
      >
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${current === item.id ? ' is-active' : ''} shrink-0`}
            aria-current={current === item.id ? 'page' : undefined}
            onClick={() => onTabChange(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0">{panels[current]}</div>
    </section>
  );
}
