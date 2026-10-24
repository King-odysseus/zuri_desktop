import Footer from '../components/Footer.jsx';
import { ChartIcon, CardIcon, GridIcon, ReceiptIcon } from '../components/Icons.jsx';
import { initialsFor } from '../lib/format.js';
import OverviewView from './OverviewView.jsx';
import UsageView from './UsageView.jsx';
import PlansView from './PlansView.jsx';
import BillingView from './BillingView.jsx';

export const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: <GridIcon /> },
  { id: 'usage', label: 'Usage and limits', short: 'Usage', icon: <ChartIcon /> },
  { id: 'plans', label: 'Plans', short: 'Plans', icon: <CardIcon /> },
  { id: 'billing', label: 'Billing', short: 'Billing', icon: <ReceiptIcon /> },
];

function NavList({ view, onViewChange, compact }) {
  return NAV_ITEMS.map((item) => (
    <button
      key={item.id}
      type="button"
      className={`${compact ? 'tab' : 'nav-item'}${view === item.id ? ' is-active' : ''}`}
      onClick={() => onViewChange(item.id)}
      aria-current={view === item.id ? 'page' : undefined}
    >
      {item.icon}
      <span>{compact ? item.short : item.label}</span>
    </button>
  ));
}

/**
 * Signed-in shell. Sidebar on wide screens, a fixed bottom tab bar below 900px
 * so the four destinations stay reachable with a thumb.
 */
export default function Dashboard({ account, plans, view, busy, onViewChange, onChoose, onSignIn }) {
  const user = account.me?.user ?? {};
  const name = user.displayName || user.email || 'Zuri user';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="account-card">
          <span className="avatar">{initialsFor(user.displayName, user.email)}</span>
          <span style={{ minWidth: 0 }}>
            <span className="account-name" style={{ display: 'block' }}>
              {name}
            </span>
            <span className="account-email" style={{ display: 'block' }}>
              {user.email ?? ''}
            </span>
          </span>
        </div>
        <nav className="nav" aria-label="Dashboard sections">
          <NavList view={view} onViewChange={onViewChange} />
        </nav>
        <p className="stat-meta" style={{ marginTop: 'auto' }}>
          Signed in to Zuri Cloud.
        </p>
      </aside>

      <main className="app-main">
        <div className="app-content">
          {view === 'overview' && <OverviewView me={account.me} usage={account.usage} />}
          {view === 'usage' && <UsageView usage={account.usage} limits={account.limits} />}
          {view === 'plans' && (
            <PlansView
              plans={plans}
              currentPlan={account.me?.subscription?.planCode ?? null}
              busy={busy}
              onChoose={onChoose}
              onSignIn={onSignIn}
            />
          )}
          {view === 'billing' && <BillingView me={account.me} billing={account.billing} />}

          <div className="app-foot">
            <Footer compact />
          </div>
        </div>
      </main>

      <nav className="tabbar" aria-label="Dashboard sections">
        <NavList view={view} onViewChange={onViewChange} compact />
      </nav>
    </div>
  );
}
