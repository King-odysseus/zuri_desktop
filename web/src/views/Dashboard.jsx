import Footer from '../components/Footer.jsx';
import DownloadLink from '../components/DownloadLink.jsx';
import { ChartIcon, CardIcon, CloseIcon, GridIcon, MenuIcon, MessageIcon, ReceiptIcon, ShieldIcon } from '../components/Icons.jsx';
import AdminView from './AdminView.jsx';
import { initialsFor } from '../lib/format.js';
import ChatView from './ChatView.jsx';
import OverviewView from './OverviewView.jsx';
import UsageView from './UsageView.jsx';
import PlansView from './PlansView.jsx';
import BillingView from './BillingView.jsx';

export const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: <MessageIcon /> },
  { id: 'overview', label: 'Overview', icon: <GridIcon /> },
  { id: 'usage', label: 'Usage and limits', icon: <ChartIcon /> },
  { id: 'plans', label: 'Plans', icon: <CardIcon /> },
  { id: 'billing', label: 'Billing', icon: <ReceiptIcon /> },
];

// Shown only to administrators; the server refuses the data to anyone else.
const ADMIN_ITEM = { id: 'admin', label: 'Admin', icon: <ShieldIcon /> };

function NavList({ view, onViewChange, isAdmin }) {
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
  return items.map((item) => (
    <button
      key={item.id}
      type="button"
      className={`nav-item${view === item.id ? ' is-active' : ''}`}
      onClick={() => onViewChange(item.id)}
      aria-current={view === item.id ? 'page' : undefined}
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  ));
}

/**
 * The navigation panel: the account, the destinations and the download link.
 *
 * The chat renders this inside its own list column, so a chat has one sidebar holding
 * both the destinations and the conversations, the way the desktop app does. Every
 * other page renders it as the docked sidebar, or the drawer on a phone.
 */
function SidebarContents({ user, name, view, onViewChange, onCloseNav, withAccount = true }) {
  return (
    <>
      {withAccount && (
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
      )}
      {/* The bar already names the app once the panel is docked, so only the drawer shows this. */}
      <div className="sidebar-drawer-head">
        <span className="brand-name">Zuri Cloud</span>
        <button type="button" className="icon-btn" onClick={onCloseNav} aria-label="Close navigation">
          <CloseIcon />
        </button>
      </div>
      <nav className="nav" aria-label="Dashboard sections">
        <NavList view={view} onViewChange={onViewChange} isAdmin={user.isAdmin === true} />
      </nav>
      <p className="stat-meta sidebar-note">Signed in to Zuri Cloud.</p>
      <DownloadLink className="sidebar-download" />
    </>
  );
}

/**
 * Signed-in shell. The navigation is a sidebar on a wide screen and a drawer behind a
 * floating button below 900px, so no bottom bar covers the chat composer. The chat
 * carries the navigation itself, which is why the docked sidebar is skipped there.
 */
export default function Dashboard({ account, plans, view, busy, topups, busyTopup, onViewChange, onChoose, onTopUp, onSignIn, navOpen, onOpenNav, onCloseNav }) {
  const user = account.me?.user ?? {};
  const name = user.displayName || user.email || 'Zuri user';
  const isChat = view === 'chat';
  const navigation = (
    <SidebarContents
      user={user}
      name={name}
      view={view}
      onViewChange={onViewChange}
      onCloseNav={onCloseNav}
    />
  );

  return (
    <div className="app">
      {!isChat && (
        <aside className={`sidebar${navOpen ? ' is-open' : ''}`} aria-label="Dashboard navigation">
          {navigation}
        </aside>
      )}

      <main className={`app-main${isChat ? ' is-chat' : ''}`}>
        <div className="app-content">
          {isChat && (
            <ChatView
              onSignIn={onSignIn}
              userName={user.displayName ?? ''}
              navigation={navigation}
            />
          )}
          {view === 'overview' && <OverviewView me={account.me} usage={account.usage} />}
          {view === 'usage' && (
            <UsageView
              usage={account.usage}
              limits={account.limits}
              topups={topups}
              busyTopup={busyTopup}
              onTopUp={onTopUp}
            />
          )}
          {view === 'plans' && (
            <PlansView
              plans={plans}
              currentPlan={account.me?.subscription?.planCode ?? null}
              busy={busy}
              onChoose={onChoose}
              onSignIn={onSignIn}
            />
          )}
          {view === 'billing' && (
            <BillingView me={account.me} billing={account.billing} usage={account.usage} />
          )}
          {view === 'admin' && user.isAdmin === true && <AdminView />}

          {!isChat && (
            <div className="app-foot">
              <Footer compact />
            </div>
          )}
        </div>
      </main>

      {/* Below the sidebar breakpoint the navigation is a drawer opened by this floating
          button. The chat draws its own controls, and the drawer is not used there
          because its list column already carries the navigation. */}
      {!isChat && !navOpen && (
        <button
          type="button"
          className="nav-fab"
          onClick={onOpenNav}
          aria-label="Open navigation"
          aria-expanded="false"
        >
          <MenuIcon />
        </button>
      )}

      {/* A tap outside the drawer closes it. The scrim is hidden once the sidebar is
          docked at the wide breakpoint. */}
      {!isChat && navOpen && (
        <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={onCloseNav} />
      )}
    </div>
  );
}
