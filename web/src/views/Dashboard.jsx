import Footer from '../components/Footer.jsx';
import DownloadLink from '../components/DownloadLink.jsx';
import { ChartIcon, CardIcon, GridIcon, MessageIcon, ReceiptIcon, ShieldIcon } from '../components/Icons.jsx';
import AdminView from './AdminView.jsx';
import { initialsFor } from '../lib/format.js';
import ChatView from './ChatView.jsx';
import OverviewView from './OverviewView.jsx';
import UsageView from './UsageView.jsx';
import PlansView from './PlansView.jsx';
import BillingView from './BillingView.jsx';

export const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', short: 'Chat', icon: <MessageIcon /> },
  { id: 'overview', label: 'Overview', short: 'Overview', icon: <GridIcon /> },
  { id: 'usage', label: 'Usage and limits', short: 'Usage', icon: <ChartIcon /> },
  { id: 'plans', label: 'Plans', short: 'Plans', icon: <CardIcon /> },
  { id: 'billing', label: 'Billing', short: 'Billing', icon: <ReceiptIcon /> },
];

// Shown only to administrators; the server refuses the data to anyone else.
const ADMIN_ITEM = { id: 'admin', label: 'Admin', short: 'Admin', icon: <ShieldIcon /> };

function NavList({ view, onViewChange, compact, isAdmin }) {
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
  return items.map((item) => (
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
 * so every destination stays reachable with a thumb.
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
          <NavList view={view} onViewChange={onViewChange} isAdmin={user.isAdmin === true} />
        </nav>
        <p className="stat-meta" style={{ marginTop: 'auto' }}>
          Signed in to Zuri Cloud.
        </p>
        <DownloadLink className="sidebar-download" />
      </aside>

      <main className="app-main">
        <div className="app-content">
          {view === 'chat' && <ChatView onSignIn={onSignIn} />}
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
          {view === 'admin' && user.isAdmin === true && <AdminView />}

          <div className="app-foot">
            <Footer compact />
          </div>
        </div>
      </main>

      <nav className="tabbar" aria-label="Dashboard sections">
        <NavList view={view} onViewChange={onViewChange} compact isAdmin={user.isAdmin === true} />
      </nav>
    </div>
  );
}
