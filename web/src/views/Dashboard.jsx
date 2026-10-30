import { useState } from 'react';
import Footer from '../components/Footer.jsx';
import DownloadLink from '../components/DownloadLink.jsx';
import { Button, IconButton } from '../components/ui.jsx';
import { AutomationIcon, BellIcon, ChartIcon, CardIcon, CloseIcon, FolderIcon, GridIcon, ImageIcon, LogoMark, MenuIcon, MessageIcon, MoonIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, ReceiptIcon, ShieldIcon, SignOutIcon, SunIcon, TaskIcon } from '../components/Icons.jsx';
import AdminView from './AdminView.jsx';
import { initialsFor } from '../lib/format.js';
import ChatView from './ChatView.jsx';
import OverviewView from './OverviewView.jsx';
import UsageView from './UsageView.jsx';
import PlansView from './PlansView.jsx';
import BillingView from './BillingView.jsx';
import ProjectsView from './ProjectsView.jsx';
import ImagesView from './ImagesView.jsx';
import TasksView from './TasksView.jsx';
import RemindersView from './RemindersView.jsx';
import AutomationsView from './AutomationsView.jsx';
import AccountView from './AccountView.jsx';

const COLLAPSE_KEY = 'zuri-cloud-nav-collapsed';

/** Whether the panel was left collapsed the last time this browser saw it. */
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    // Private browsing can refuse storage; the panel then simply starts open.
    return false;
  }
}

export const NAV_ITEMS = [
  { id: 'chat', label: 'Chat', icon: <MessageIcon /> },
  { id: 'projects', label: 'Projects', icon: <FolderIcon /> },
  { id: 'tasks', label: 'Tasks', icon: <TaskIcon /> },
  { id: 'reminders', label: 'Reminders', icon: <BellIcon /> },
  { id: 'automations', label: 'Automations', icon: <AutomationIcon /> },
  { id: 'images', label: 'Images', icon: <ImageIcon /> },
  { id: 'overview', label: 'Overview', icon: <GridIcon /> },
  { id: 'usage', label: 'Usage and limits', icon: <ChartIcon /> },
  { id: 'plans', label: 'Plans', icon: <CardIcon /> },
  { id: 'billing', label: 'Billing', icon: <ReceiptIcon /> },
  { id: 'account', label: 'Account', icon: <ShieldIcon /> },
];

// Shown only to administrators; the server refuses the data to anyone else.
const ADMIN_ITEM = { id: 'admin', label: 'Admin', icon: <ShieldIcon /> };

function NavList({ view, onViewChange, isAdmin }) {
  // Keep a deep-linked /admin view visible while it loads. The API remains the
  // authority, so a non-admin still receives the normal server refusal.
  const items = isAdmin || view === 'admin' ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
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
 * The navigation panel: the brand, the account, the destinations, the download
 * link and the account actions.
 *
 * The chat renders this inside its own list column, so a chat has one sidebar
 * holding both the destinations and the conversations, the way the desktop app
 * does. Every other page renders it as the docked sidebar, or the drawer on a
 * phone.
 */
function SidebarContents({ user, name, view, onViewChange, onCloseNav, theme, onToggleTheme, onSignOut, collapsed = false, onToggleCollapsed = () => {}, withAccount = true }) {
  return (
    <>
      {/* The shell has no top bar, so the app is named here, as the desktop app's
          panel names it. On a phone this row also carries the way out of the drawer. */}
      <div className="sidebar-brand">
        <span className="brand-mark">
          <LogoMark size={20} />
        </span>
        <span className="brand-name">Zuri Cloud</span>
        <span className="sidebar-brand-actions">
          <IconButton
            size="sm"
            className="sidebar-collapse"
            label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </IconButton>
          <IconButton
            size="sm"
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <IconButton label="Close navigation" size="sm" className="sidebar-brand-close" onClick={onCloseNav}>
            <CloseIcon />
          </IconButton>
        </span>
      </div>
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
      <nav className="nav" aria-label="Dashboard sections">
        <NavList view={view} onViewChange={onViewChange} isAdmin={user.isAdmin === true} />
      </nav>
      <p className="stat-meta sidebar-note">Signed in to Zuri Cloud.</p>
      <DownloadLink className="sidebar-download" />
      {/* At the foot, because leaving the account is not part of the workspace. */}
      <div className="sidebar-foot">
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          <SignOutIcon />
          <span>Sign out</span>
        </Button>
      </div>
    </>
  );
}

/**
 * Signed-in shell. The navigation is a sidebar on a wide screen and a drawer behind a
 * floating button below 900px, so no bottom bar covers the chat composer. The chat
 * carries the navigation itself, which is why the docked sidebar is skipped there.
 */
export default function Dashboard({ account, plans, view, busy, topups, busyTopup, onViewChange, onChoose, onTopUp, onSignIn, onSignOut, theme, onToggleTheme, navOpen, onOpenNav, onCloseNav }) {
  const user = account.me?.user ?? {};
  const name = user.displayName || user.email || 'Zuri user';
  const isChat = view === 'chat';
  // The panel can be folded away to its icons and opened again, as the desktop
  // app allows. The choice is kept, so a reload does not undo it.
  const [navCollapsed, setNavCollapsed] = useState(readCollapsed);
  // Chat shown inside a project keeps that project here rather than in the URL, so
  // the ordinary Chat entry stays the plain history and needs no extra route.
  const [chatProject, setChatProject] = useState(null);
  const toggleCollapsed = () => {
    setNavCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Nothing to do: the panel still collapses for this visit.
      }
      return next;
    });
  };
  const chooseView = (next) => {
    if (next !== 'chat') setChatProject(null);
    onViewChange(next);
  };

  const navigation = (
    <SidebarContents
      collapsed={navCollapsed}
      onToggleCollapsed={toggleCollapsed}
      user={user}
      name={name}
      view={view}
      onViewChange={chooseView}
      onCloseNav={onCloseNav}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onSignOut={onSignOut}
    />
  );

  return (
    <div className="app">
      {!isChat && (
        <aside className={`sidebar${navOpen ? ' is-open' : ''}${navCollapsed ? ' is-collapsed' : ''}`} aria-label="Dashboard navigation">
          {navigation}
        </aside>
      )}

      <main className={`app-main${isChat ? ' is-chat' : ''}`}>
        <div className="app-content">
          {isChat && (
            <ChatView
              navCollapsed={navCollapsed}
              onToggleCollapsed={toggleCollapsed}
              onSignIn={onSignIn}
              userName={user.displayName ?? ''}
              navigation={navigation}
              projectId={chatProject?.id ?? ''}
              projectName={chatProject?.name ?? ''}
              onLeaveProject={() => setChatProject(null)}
            />
          )}
          {view === 'projects' && (
            <ProjectsView
              onStartChat={(project) => {
                // A project can arrive as an id or as the object the screen holds, so
                // both are accepted and the banner still has a name to show.
                setChatProject(typeof project === 'string' ? { id: project, name: '' } : project);
                onViewChange('chat');
              }}
            />
          )}
          {view === 'tasks' && <TasksView />}
          {view === 'reminders' && <RemindersView />}
          {view === 'automations' && <AutomationsView />}
          {view === 'images' && <ImagesView />}
          {view === 'overview' && (
            <OverviewView me={account.me} usage={account.usage} onViewChange={onViewChange} />
          )}
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
              // Pending Starter is only a checkout placeholder. Keep the
              // Starter action visible so a new account can activate it.
              currentPlan={account.me?.subscription?.status === 'pending'
                ? null
                : account.me?.subscription?.planCode ?? null}
              busy={busy}
              onChoose={onChoose}
              onSignIn={onSignIn}
              // An administrator never checks out: their plan, and every account's,
              // is set on the Admin tab's People list at no cost.
              admin={user.isAdmin === true}
            />
          )}
          {view === 'billing' && (
            <BillingView me={account.me} billing={account.billing} usage={account.usage} />
          )}
          {view === 'account' && <AccountView me={account.me} onSignOut={onSignOut} />}
          {view === 'admin' && <AdminView />}

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
        <IconButton
          className="nav-fab"
          label="Open navigation"
          aria-expanded="false"
          onClick={onOpenNav}
        >
          <MenuIcon />
        </IconButton>
      )}

      {/* A tap outside the drawer closes it. The scrim is hidden once the sidebar is
          docked at the wide breakpoint. */}
      {!isChat && navOpen && (
        <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={onCloseNav} />
      )}
    </div>
  );
}
