import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Footer from '../components/Footer.jsx';
import DownloadLink from '../components/DownloadLink.jsx';
import { Button, IconButton } from '../components/ui.jsx';
import { AutomationIcon, BellIcon, ChevronUpIcon, DownloadIcon, FolderIcon, ImageIcon, LockIcon, LogoMark, MessageIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SettingsIcon, ShieldIcon, SignOutIcon, TaskIcon } from '../components/Icons.jsx';
import AdminView from './AdminView.jsx';
import { initialsFor, planLabel } from '../lib/format.js';
import ChatView from './ChatView.jsx';
import HistoryView from './HistoryView.jsx';
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
import NotificationsView from './NotificationsView.jsx';
import SettingsView from './SettingsView.jsx';

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
  { id: 'notifications', label: 'Notifications', icon: <BellIcon /> },
  { id: 'automations', label: 'Automations', icon: <AutomationIcon /> },
  { id: 'images', label: 'Images', icon: <ImageIcon /> },
];

// The sections of the admin report, scrolled to by id; the ids live in AdminView.
const ADMIN_SECTIONS = [
  { id: 'admin-stats', label: 'Stats' },
  { id: 'admin-people', label: 'People' },
  { id: 'admin-models', label: 'Models' },
  { id: 'admin-plans', label: 'Plans' },
];

function NavList({ view, onViewChange }) {
  return NAV_ITEMS.map((item) => (
    <Button
      variant="ghost"
      key={item.id}
      type="button"
      className={`nav-item justify-start${view === item.id ? ' is-active' : ''}`}
      onClick={() => onViewChange(item.id)}
      aria-current={view === item.id ? 'page' : undefined}
    >
      {item.icon}
      <span>{item.label}</span>
    </Button>
  ));
}

/**
 * The account button at the foot of the sidebar and the small menu it opens.
 * The admin entry is cosmetic: the server still refuses admin data to anyone else.
 */
function AccountMenu({ user, name, planText, inAdmin, onViewChange, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const wrapRef = useRef(null);
  const toggleRef = useRef(null);
  const menuRef = useRef(null);
  const isAdmin = user.isAdmin === true;

  // Fixed rather than absolute: a collapsed or scrolling sidebar would clip the menu.
  useLayoutEffect(() => {
    if (!open || !toggleRef.current) return;
    const rect = toggleRef.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action) => {
    setOpen(false);
    action();
  };
  const row = 'flex min-h-11 w-full items-center justify-start gap-3 rounded-xl px-3 text-sm [&>svg]:text-[var(--muted)] hover:bg-surface-secondary';

  return (
    <div className="sidebar-account relative mt-auto" ref={wrapRef}>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="fixed z-[80] w-60 rounded-2xl bg-surface p-1.5 text-body shadow-[0_10px_32px_rgba(13,27,58,0.18)]"
          style={{ left: position.left, bottom: position.bottom }}
        >
          {isAdmin && !inAdmin && (
            <Button type="button" variant="secondary" role="menuitem" className={`${row} bg-bronze-soft font-medium text-bronze-ink`} onClick={() => choose(() => onViewChange('admin'))}>
              <ShieldIcon />
              <span>Switch to admin view</span>
            </Button>
          )}
          <Button type="button" variant="ghost" role="menuitem" className={row} onClick={() => choose(() => onViewChange('settings'))}>
            <SettingsIcon />
            <span>Settings</span>
          </Button>
          <div role="none" onClick={() => setOpen(false)}>
            <DownloadLink
              className="flex min-h-11 w-full items-center justify-start gap-3 rounded-xl px-3 text-sm [&>svg]:text-[var(--muted)] hover:bg-surface-secondary"
              icon={<DownloadIcon />}
            />
          </div>
          <Button type="button" variant="ghost" role="menuitem" className={row} onClick={() => choose(onSignOut)}>
            <SignOutIcon />
            <span>Sign out</span>
          </Button>
        </div>
      )}
      {/* Below 900px the panel is the whole screen, and a folded panel leaves this
          row holding only the avatar. A HeroUI button centres what it holds, which
          floated that one avatar in the middle of the row while every other row
          started at the left edge. The wide rail still centres it, where the icons
          above the account are centred too. */}
      <Button
        variant="ghost"
        ref={toggleRef}
        type="button"
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left hover:bg-black/5 max-[900px]:justify-start"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="avatar">{initialsFor(user.displayName, user.email)}</span>
        {/* The folded rail (900px and wider) keeps the avatar alone and hides these
            two by name; the phone drawer is always full width and keeps them. */}
        <span className="account-copy min-w-0 flex-1">
          <span className="account-name block truncate">{name}</span>
          <span className="account-email block truncate">{planText}</span>
        </span>
        <ChevronUpIcon className="account-chevron" />
      </Button>
    </div>
  );
}

/** The brand row: name, and collapse toggle. Shared by both sidebars. */
function BrandRow({ collapsed, onToggleCollapsed, badge = null }) {
  return (
    <div className="sidebar-brand">
      <span className="brand-mark">
        <LogoMark size={20} />
      </span>
      <span className="brand-name">Zuri Cloud</span>
      {badge}
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
      </span>
    </div>
  );
}

/**
 * The user navigation panel: the brand, the destinations and the account button.
 *
 * The chat renders this inside its own list column, so a chat has one sidebar
 * holding both the destinations and the conversations, the way the desktop app
 * does. Every other page renders it as the docked sidebar.
 */
function SidebarContents({ user, name, planText, view, onViewChange, theme, onToggleTheme, onSignOut, collapsed = false, onToggleCollapsed = () => {} }) {
  return (
    <>
      <BrandRow collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <nav className="nav" aria-label="Dashboard sections">
        <NavList view={view} onViewChange={onViewChange} />
      </nav>
      <AccountMenu user={user} name={name} planText={planText} inAdmin={false} onViewChange={onViewChange} onSignOut={onSignOut} />
    </>
  );
}

/** The admin sidebar: an Admin badge, the way back to the user view and the report sections. */
function AdminSidebarContents({ user, name, planText, onViewChange, theme, onToggleTheme, onSignOut, collapsed, onToggleCollapsed }) {
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <>
      <BrandRow
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        badge={<span className="rounded-full bg-bronze-soft px-2 py-0.5 text-xs font-semibold text-bronze-ink">Admin</span>}
      />
      <Button variant="secondary" block onClick={() => onViewChange('chat')}>
        <MessageIcon />
        <span>Switch to user view</span>
      </Button>
      <nav className="nav" aria-label="Admin sections">
        {ADMIN_SECTIONS.map((item) => (
          <Button variant="ghost" key={item.id} type="button" className="nav-item justify-start" onClick={() => jump(item.id)}>
            <ShieldIcon />
            <span>{item.label}</span>
          </Button>
        ))}
      </nav>
      <AccountMenu user={user} name={name} planText={planText} inAdmin onViewChange={onViewChange} onSignOut={onSignOut} />
    </>
  );
}

/** What a non-admin sees at an admin address. The server refuses the data regardless. */
function NoAccess({ onViewChange }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center" aria-labelledby="no-access-title">
      <span className="grid size-14 place-items-center rounded-full bg-bronze-soft text-bronze-ink">
        <LockIcon />
      </span>
      <h1 id="no-access-title" className="font-display text-2xl font-extrabold">This area is for admins</h1>
      <p className="max-w-sm text-muted">Your account does not have admin access, so this page is hidden. Ask an owner to give you access.</p>
      <Button onClick={() => onViewChange('chat')}>Back to chat</Button>
    </section>
  );
}

/**
 * Signed-in shell. The navigation is a sidebar on a wide screen and a bottom tab bar
 * below 900px. The chat carries the navigation itself, which is why the docked sidebar
 * is skipped there. Admins get a separate frame with its own sidebar.
 */
export default function Dashboard({ account, plans, view, settingsTab, busy, topups, busyTopup, onViewChange, onChoose, onTopUp, onSignIn, onSignOut, theme, onToggleTheme }) {
  const user = account.me?.user ?? {};
  const name = user.displayName || user.email || 'Zuri user';
  const isAdmin = user.isAdmin === true;
  const planCode = account.me?.subscription?.planCode;
  const planText = isAdmin ? 'Admin' : planCode ? planLabel(planCode, plans) : 'No plan';
  const isChat = view === 'chat';
  const inAdminFrame = view === 'admin' && isAdmin;
  // The panel can be folded away to its icons and opened again, as the desktop
  // app allows. The choice is kept, so a reload does not undo it.
  const [navCollapsed, setNavCollapsed] = useState(readCollapsed);
  // Chat shown inside a project keeps that project here rather than in the URL, so
  // the ordinary Chat entry stays the plain history and needs no extra route.
  const [chatProject, setChatProject] = useState(null);
  // Bumped when a chat is deleted or restored on the history screen, so the Recents
  // column is built again instead of showing a row that no longer exists.
  const [chatsVersion, setChatsVersion] = useState(0);
  // Below 900px the sidebar is a drawer that a floating button calls out, as on the desktop app.
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    setDrawerOpen(false);
    if (next !== 'chat') setChatProject(null);
    onViewChange(next);
  };

  const sidebarProps = {
    collapsed: navCollapsed,
    onToggleCollapsed: toggleCollapsed,
    user,
    name,
    planText,
    onViewChange: chooseView,
    theme,
    onToggleTheme,
    onSignOut,
  };
  const navigation = <SidebarContents {...sidebarProps} view={view} />;

  const settingsPanels = {
    overview: <OverviewView me={account.me} usage={account.usage} onViewChange={onViewChange} />,
    usage: (
      <UsageView
        usage={account.usage}
        limits={account.limits}
        topups={topups}
        busyTopup={busyTopup}
        onTopUp={onTopUp}
      />
    ),
    plans: (
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
        admin={isAdmin}
      />
    ),
    billing: <BillingView me={account.me} billing={account.billing} usage={account.usage} />,
    account: <AccountView me={account.me} onSignOut={onSignOut} />,
  };

  return (
    <div className="app">
      {!isChat && drawerOpen && <Button variant="ghost" className="nav-scrim" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />}
      {!isChat && (
        <IconButton className="nav-fab" label="Open menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
          <PanelLeftOpenIcon />
        </IconButton>
      )}
      {!isChat && (
        <aside className={`sidebar${navCollapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-open' : ''}`} aria-label={inAdminFrame ? 'Admin navigation' : 'Dashboard navigation'}>
          {inAdminFrame ? <AdminSidebarContents {...sidebarProps} /> : navigation}
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
              onOpenHistory={() => onViewChange('history')}
              historyVersion={chatsVersion}
            />
          )}
          {view === 'history' && (
            <HistoryView
              onBackToChat={() => onViewChange('chat')}
              // A chat deleted or restored here changes the Recents column, so the
              // shell is told and refetches rather than leaving a stale row behind.
              onChanged={() => setChatsVersion((current) => current + 1)}
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
          {view === 'notifications' && <NotificationsView />}
          {view === 'automations' && <AutomationsView />}
          {view === 'images' && <ImagesView />}
          {view === 'settings' && <SettingsView tab={settingsTab} onTabChange={onViewChange} panels={settingsPanels} theme={theme} onToggleTheme={onToggleTheme} />}
          {/* A non-admin never mounts AdminView, so the admin API is not even called. */}
          {view === 'admin' && (isAdmin ? <AdminView /> : <NoAccess onViewChange={chooseView} />)}

          {!isChat && (
            <div className="app-foot">
              <Footer compact />
            </div>
          )}
        </div>
      </main>

    </div>
  );
}
