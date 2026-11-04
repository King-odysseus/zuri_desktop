import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import {
  AgentIcon,
  ArchiveIcon,
  AutomationIcon,
  BellIcon,
  ChatIcon,
  CloudIcon,
  EditIcon,
  FeaturesIcon,
  HistoryIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  DeleteIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SignOutIcon,
  UserIcon,
  SkillsIcon,
  MoonIcon,
  OverlayIcon,
  PinIcon,
  GridIcon,
  SunIcon,
  SyncIcon,
  TaskIcon,
} from './Icons.jsx';
import { projectIconFor } from './projectIcons.js';

/*
 * A Mac keyboard has no Ctrl and a Windows keyboard has no Command, so the hint
 * names whichever key this machine has. The window's handler accepts both (see
 * App.jsx), so only the label follows the platform.
 */
export const NEW_CHAT_HINT =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '') ? 'Cmd K' : 'Ctrl K';

export const NAV_ITEMS = [
  { key: 'chats', label: 'Chats', Icon: ChatIcon },
  { key: 'agents', label: 'Agents', Icon: AgentIcon },
  { key: 'skills', label: 'Skills', Icon: SkillsIcon },
  { key: 'plugins', label: 'Plugins', Icon: GridIcon },
  { key: 'tasks', label: 'Tasks', Icon: TaskIcon },
  { key: 'reminders', label: 'Reminders', Icon: BellIcon },
  { key: 'automations', label: 'Automations', Icon: AutomationIcon },
  { key: 'images', label: 'Images', Icon: ImageIcon },
  { key: 'files', label: 'Files', Icon: FolderIcon },
  { key: 'features', label: 'Features', Icon: FeaturesIcon },
  { key: 'cloud', label: 'Zuri Cloud', Icon: CloudIcon },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

// The overlay shortcut the main process registers, named in this machine's keys.
export const QUICK_ASK_HINT =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '') ? 'Cmd Alt Space' : 'Ctrl Alt Space';

/** The round initial shown until Zuri has a picture for the person. */
function initialFor(name, email) {
  const source = String(name || email || 'Z').trim();
  return source.charAt(0).toUpperCase() || 'Z';
}

/**
 * One row of the account menu, drawn the way ChatGPT's is: a quiet icon, the word,
 * and a shortcut or count pushed to the right edge.
 */
function AccountMenuRow({ Icon, label, hint, onPress }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="zuri-account-row"
      onClick={onPress}
    >
      <Icon size={16} className="zuri-account-row-icon" />
      <span className="zuri-account-row-label">{label}</span>
      {hint && <span className="zuri-account-row-hint">{hint}</span>}
    </button>
  );
}

// A short, calm list: the everyday destinations stay on screen and the rest fold under
// More, so Recents keeps most of the height. Settings lives in the account menu.
const PRIMARY_KEYS = ['tasks', 'reminders', 'automations', 'files'];
const MORE_KEYS = ['agents', 'skills', 'plugins', 'images', 'features', 'cloud'];
const PRIMARY_ITEMS = NAV_ITEMS.filter(({ key }) => PRIMARY_KEYS.includes(key));
const MORE_ITEMS = NAV_ITEMS.filter(({ key }) => MORE_KEYS.includes(key));

/*
 * The sidebar can be dragged wider or narrower. The limits keep it usable at both
 * ends: below the minimum the New chat row and the account row no longer fit, and
 * above the maximum it starts to crowd out the conversation. The choice is kept on
 * this computer so the next launch opens at the width the person left it.
 */
const SIDEBAR_WIDTH_KEY = 'zuri.sidebarWidth';
export const SIDEBAR_DEFAULT_WIDTH = 288;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_KEY_STEP = 16;

export function clampSidebarWidth(value) {
  const width = Number.isFinite(value) ? Math.round(value) : SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth() {
  try {
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return saved > 0 ? clampSidebarWidth(saved) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    // Storage can be blocked; the default width is a fine place to start.
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveSidebarWidth(width) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Not being able to remember the width must never get in the way of resizing it.
  }
}

export default function Sidebar({ current, onNavigate, onNewChat, onSelectThread, onEditProject = () => {}, activeThreadId, refreshKey, theme, onToggleTheme, collapsed = false, onToggleCollapsed = () => {} }) {
  const [threads, setThreads] = useState([]);
  const [projects, setProjects] = useState([]);
  // Which projects are open in the list, and which chat is choosing a project.
  const [openProjectIds, setOpenProjectIds] = useState([]);
  const [movingThreadId, setMovingThreadId] = useState('');
  // Reminders whose time has come and that are still open: what the bell counts.
  const [dueReminders, setDueReminders] = useState(0);
  // The account menu at the foot, and whether the secondary destinations are unfolded.
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef(null);

  // Who is signed in and what plan pays for the answers, for the account button.
  const [account, setAccount] = useState(null);
  // The Sync press beside Recents: in flight, and the one line it leaves behind.
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  // How wide the panel is, and whether the edge is being dragged right now. The width
  // animation is switched off during a drag, or the panel would trail the pointer.
  const [width, setWidth] = useState(readSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: SIDEBAR_DEFAULT_WIDTH });

  function beginResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width };
    setResizing(true);
  }

  function continueResize(event) {
    if (!resizing) return;
    setWidth(clampSidebarWidth(dragRef.current.startWidth + event.clientX - dragRef.current.startX));
  }

  function endResize(event) {
    if (!resizing) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizing(false);
    saveSidebarWidth(width);
  }

  function resizeFromKeyboard(event) {
    const step = { ArrowLeft: -SIDEBAR_KEY_STEP, ArrowRight: SIDEBAR_KEY_STEP }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = clampSidebarWidth(width + step);
    setWidth(next);
    saveSidebarWidth(next);
  }

  function resetWidth() {
    setWidth(SIDEBAR_DEFAULT_WIDTH);
    saveSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }

  useEffect(() => {
    let active = true;
    const loadAccount = async () => {
      const result = await window.zuri?.cloud?.account?.();
      if (active && result?.ok) setAccount(result.data ?? null);
    };
    void loadAccount();
    // Signing out empties the row; a new name saved in Settings refreshes it.
    const clearAccount = () => setAccount(null);
    window.addEventListener('zuri:signed-out', clearAccount);
    window.addEventListener('zuri:account-changed', loadAccount);
    return () => {
      active = false;
      window.removeEventListener('zuri:signed-out', clearAccount);
      window.removeEventListener('zuri:account-changed', loadAccount);
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  useEffect(() => {
    let active = true;
    const loadThreads = async () => {
      const result = await window.zuri?.chats?.list?.();
      if (active && result?.ok) setThreads(Array.isArray(result.data) ? result.data : []);
    };
    const loadDueReminders = async () => {
      const result = await window.zuri?.reminders?.list?.();
      if (!active || !result?.ok || !Array.isArray(result.data)) return;
      const now = Date.now();
      setDueReminders(result.data.filter((reminder) => Date.parse(reminder?.dueAt) <= now).length);
    };
    const loadProjects = async () => {
      const result = await window.zuri?.projects?.list?.();
      if (active && result?.ok) setProjects(Array.isArray(result.data) ? result.data : []);
    };
    // History writes happen outside this component, so follow main's shared
    // change event instead of leaving Recents stale until the next chat reply.
    const stopListening = window.zuri?.state?.onChanged?.((change) => {
      if (change?.area === 'chats') void loadThreads();
      if (change?.area === 'projects') void loadProjects();
      // The reminder ticker announces every few seconds, so this also catches a
      // reminder that has just come due without a timer of its own.
      if (change?.area === 'reminders') void loadDueReminders();
    });
    void loadThreads();
    void loadProjects();
    void loadDueReminders();
    return () => {
      active = false;
      stopListening?.();
    };
  }, [refreshKey]);

  // A sync note is a passing remark, not a label, so it clears itself.
  useEffect(() => {
    if (syncNote === '') return undefined;
    const timer = setTimeout(() => setSyncNote(''), 6000);
    return () => clearTimeout(timer);
  }, [syncNote]);

  function toggleProject(projectId) {
    setOpenProjectIds((ids) => (ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId]));
  }

  async function moveThread(threadId, projectId) {
    setMovingThreadId('');
    await window.zuri?.chats?.move?.({ threadId, projectId });
    if (projectId !== '') setOpenProjectIds((ids) => (ids.includes(projectId) ? ids : [...ids, projectId]));
  }

  async function removeProject(project) {
    // The chats inside go back to Recents; only the folder is deleted.
    if (!window.confirm(`Delete the project "${project.name}"? Its chats are kept and move back to Recents.`)) return;
    await window.zuri?.projects?.delete?.({ projectId: project.id });
  }

  async function setFlags(thread, flags) {
    await window.zuri?.chats?.flags?.({ threadId: thread.id, ...flags });
  }

  const projectIds = new Set(projects.map((project) => project.id));
  // Archived chats leave Recents but stay in Chat history. Pinned ones rise to the
  // top; the sort is stable, so each group keeps main's newest-first order.
  const visibleThreads = threads
    .filter((thread) => thread.archived !== true)
    .sort((left, right) => Number(right.pinned === true) - Number(left.pinned === true));
  // A chat whose project is gone still shows in Recents instead of vanishing.
  const looseThreads = visibleThreads.filter((thread) => !projectIds.has(thread.projectId));

  function renderThread(thread) {
    const label = thread.title || 'New chat';
    return (
      <div key={thread.id} className="group mb-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={thread.id === activeThreadId ? 'secondary' : 'ghost'}
            fullWidth
            className="min-w-0 flex-1 justify-start truncate rounded-lg px-2 py-2 text-left"
            onPress={() => onSelectThread(thread.id)}
          >
            {thread.pinned === true && <PinIcon size={12} className="mr-1 shrink-0" aria-hidden="true" />}
            <span className="zuri-thread-title" title={label}>{label}</span>
          </Button>
          {/* Shown on hover or keyboard focus so the title keeps the room it needs. */}
          <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-9 rounded-lg text-muted"
              aria-label={thread.pinned === true ? `Unpin "${label}"` : `Pin "${label}"`}
              title={thread.pinned === true ? 'Unpin' : 'Pin to top'}
              onPress={() => void setFlags(thread, { pinned: thread.pinned !== true })}
            >
              <PinIcon size={15} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-9 rounded-lg text-muted"
              aria-label={`Archive "${label}"`}
              title="Archive (kept in Chat history)"
              onPress={() => void setFlags(thread, { archived: true })}
            >
              <ArchiveIcon size={15} />
            </Button>
          </div>
          {projects.length > 0 && (
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="min-h-11 min-w-11 shrink-0 rounded-lg text-muted"
              aria-label={`Move "${thread.title || 'New chat'}" to a project`}
              title="Move to a project"
              aria-expanded={movingThreadId === thread.id}
              onPress={() => setMovingThreadId((id) => (id === thread.id ? '' : thread.id))}
            >
              <FolderIcon size={15} />
            </Button>
          )}
        </div>
        {movingThreadId === thread.id && (
          <div className="ml-2 mt-1 flex flex-col gap-1" role="menu" aria-label="Move chat to">
            {projects.map((project) => (
              <Button
                key={project.id}
                type="button"
                variant="ghost"
                role="menuitem"
                className="min-h-11 justify-start rounded-lg px-2 text-left"
                isDisabled={thread.projectId === project.id}
                onPress={() => void moveThread(thread.id, project.id)}
              >
                {project.name}
              </Button>
            ))}
            {projectIds.has(thread.projectId) && (
              <Button
                type="button"
                variant="ghost"
                role="menuitem"
                className="min-h-11 justify-start rounded-lg px-2 text-left text-muted"
                onPress={() => void moveThread(thread.id, '')}
              >
                Remove from project
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }
  function renderDestination({ key, label, Icon }) {
    return (
      <Button
        key={key}
        type="button"
        variant={current === key ? 'secondary' : 'ghost'}
        fullWidth
        className="min-h-11 justify-start gap-2 rounded-xl px-3 font-normal"
        aria-current={current === key ? 'page' : undefined}
        onPress={() => onNavigate(key)}
      >
        <Icon size={16} />
        {label}
        {key === 'reminders' && dueReminders > 0 && (
          <span className="zuri-account-count ml-auto">{dueReminders > 9 ? '9+' : dueReminders}</span>
        )}
      </Button>
    );
  }

  const accountName = account?.user?.displayName || account?.user?.email || 'Your account';
  const accountPlan = account?.subscription?.planName || (account ? 'No paid plan' : 'Not signed in');
  const initials = initialFor(account?.user?.displayName, account?.user?.email);

  /** Settings takes the whole window, so opening it from here also closes this menu. */
  function openSettings(section) {
    setMenuOpen(false);
    onNavigate('settings', section);
  }

  /**
   * Pull the account's chats down now.
   *
   * Chats are only swept at launch and after signing in, so a chat written in the
   * browser used to need a restart before this window would list it. The press does
   * the same work on demand and says what came down; the list itself refreshes from
   * main's chats change event, not from anything set here.
   */
  async function syncChats() {
    if (syncing) return;
    setSyncing(true);
    setSyncNote('');
    try {
      const result = await window.zuri?.cloud?.sync?.();
      if (result?.ok !== true) {
        setSyncNote(result?.error?.message ?? 'The chats could not be synced.');
        return;
      }
      if (result.data?.skipped === 'signed-out') {
        setSyncNote('Sign in to sync your chats.');
        return;
      }
      const arrived = Number(result.data?.appended) || 0;
      const taken = Number(result.data?.adopted) || 0;
      setSyncNote(arrived === 0
        ? 'Everything is up to date.'
        : `${arrived} new message${arrived === 1 ? '' : 's'} came down${taken > 0 ? ` from ${taken} chat${taken === 1 ? '' : 's'} started elsewhere` : ''}.`);
    } catch (failure) {
      setSyncNote(failure?.message ?? 'The chats could not be synced.');
    } finally {
      setSyncing(false);
    }
  }

  async function signOut() {
    setMenuOpen(false);
    await window.zuri?.cloud?.signOut?.();
    window.dispatchEvent(new Event('zuri:signed-out'));
  }

  return (
    <div className="flex h-full shrink-0">
      {/* No icon strip: the sidebar is one list, the way ChatGPT's is. When it is folded
          away on a screen that has no floating toggle, one small button brings it back. */}
      {collapsed && current !== 'chats' && (
        <div className="zuri-sidebar-panel flex w-12 flex-col items-center py-4">
          <Button isIconOnly size="sm" variant="ghost" aria-label="Expand sidebar" title="Expand sidebar" onPress={() => onToggleCollapsed(false)}>
            <PanelLeftOpenIcon />
          </Button>
        </div>
      )}

      <aside
        className={`zuri-sidebar-panel relative flex shrink-0 flex-col ${resizing ? '' : 'transition-[width] duration-200'} ${collapsed ? 'overflow-hidden' : ''}`}
        style={{ width: collapsed ? 0 : width }}
        aria-label="Conversations"
        aria-hidden={collapsed}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <span className="px-2 text-lg font-semibold tracking-tight">Zuri</span>
          <div className="flex items-center gap-1 text-muted">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Search conversations" title="Search conversations" onPress={() => onNavigate('search')}>
              <SearchIcon size={16} />
            </Button>
            {/* On the chat view the same control floats over the conversation, so
                keeping a second copy here would give the person two toggles. */}
            {current !== 'chats' && (
              <Button isIconOnly size="sm" variant="ghost" aria-label="Collapse sidebar" title="Collapse sidebar" onPress={() => onToggleCollapsed(true)}>
                <PanelLeftCloseIcon size={17} />
              </Button>
            )}
          </div>
        </div>

        <div className="px-3">
          <Button
            variant="ghost"
            fullWidth
            className="zuri-new-chat min-h-11 justify-start gap-2 rounded-xl px-3 font-normal"
            onPress={onNewChat}
          >
            <EditIcon size={16} />
            New chat
            <kbd className="ml-auto text-xs opacity-70 text-accent-foreground" aria-hidden="true">{NEW_CHAT_HINT}</kbd>
          </Button>
        </div>

        <nav aria-label="Destinations" className="flex flex-col gap-0.5 px-3 pt-1">
          {PRIMARY_ITEMS.map(renderDestination)}
          <Button
            type="button"
            variant="ghost"
            fullWidth
            className="min-h-11 justify-start gap-2 rounded-xl px-3 font-normal text-muted"
            aria-expanded={moreOpen}
            onPress={() => setMoreOpen((open) => !open)}
          >
            <ChevronRightIcon size={16} className={`transition-transform ${moreOpen ? 'rotate-90' : ''}`} />
            More
          </Button>
          {moreOpen && MORE_ITEMS.map(renderDestination)}
        </nav>

        <div className="flex items-center justify-between px-5 pb-2 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Projects</p>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="h-8 w-8 rounded-lg text-muted"
            aria-label="New project"
            title="New project"
            onPress={() => onNavigate('new-project')}
          >
            <FolderPlusIcon size={16} />
          </Button>
        </div>
        <div className="zuri-scrollbar-hidden max-h-40 shrink-0 overflow-y-auto px-3 text-sm text-muted">
          {projects.length === 0 && <p className="px-2">Keep one topic in one place. Create a project to group its chats.</p>}
          {projects.map((project) => {
            const ProjectIcon = projectIconFor(project.icon);
            const isOpen = openProjectIds.includes(project.id);
            const projectThreads = visibleThreads.filter((thread) => thread.projectId === project.id);
            return (
              <div key={project.id} className="mb-1">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    fullWidth
                    className="min-h-11 min-w-0 flex-1 justify-start gap-2 truncate rounded-lg px-2 text-left"
                    aria-expanded={isOpen}
                    onPress={() => toggleProject(project.id)}
                  >
                    <ChevronRightIcon size={14} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <ProjectIcon size={16} className="shrink-0" />
                    <span className="truncate">{project.name}</span>
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    className="min-h-11 min-w-11 shrink-0 rounded-lg text-muted"
                    aria-label={`Edit project ${project.name}`}
                    title="Name, icon and instructions"
                    onPress={() => onEditProject(project)}
                  >
                    <EditIcon size={15} />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    className="min-h-11 min-w-11 shrink-0 rounded-lg text-muted"
                    aria-label={`Delete project ${project.name}`}
                    title="Delete project"
                    onPress={() => void removeProject(project)}
                  >
                    <DeleteIcon size={15} />
                  </Button>
                </div>
                {isOpen && (
                  <div className="ml-4">
                    {projectThreads.length === 0 && <p className="px-2 pb-1">No chats yet. Use the folder button on a chat to add it.</p>}
                    {projectThreads.map(renderThread)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Recents</p>
          <div className="flex items-center gap-1">
            {/* Sync beside the list it fills: a chat started in the browser arrives
                here without a restart. It spins while the run is out. */}
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="h-8 w-8 rounded-lg text-muted"
              aria-label="Sync chats"
              title="Sync chats"
              isDisabled={syncing}
              onPress={() => void syncChats()}
            >
              <SyncIcon size={16} className={syncing ? 'animate-spin' : ''} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="h-8 w-8 rounded-lg text-muted"
              aria-label="Open chat history"
              title="Chat history"
              onPress={() => onNavigate('history')}
            >
              <HistoryIcon size={16} />
            </Button>
          </div>
        </div>
        {syncNote !== '' && (
          <p role="status" className="px-5 pb-2 text-xs text-muted">
            {syncNote}
          </p>
        )}
        <div className="zuri-scrollbar-hidden flex-1 overflow-y-auto px-3 text-sm text-muted">
          {threads.length === 0 && <p className="px-2">No conversations yet. Your threads will appear here, newest first.</p>}
          {looseThreads.map(renderThread)}
        </div>

        <div className="relative mt-auto border-t border-border px-3 py-3" ref={menuRef}>
          {menuOpen && (
            <div role="menu" aria-label="Your account" className="zuri-account-menu">
              <div className="zuri-account-head">
                <span className="zuri-avatar" aria-hidden="true">{initials}</span>
                <span className="zuri-account-identity">
                  <span className="zuri-account-name">{accountName}</span>
                  <span className="zuri-account-plan">{accountPlan}</span>
                </span>
              </div>

              <div className="zuri-account-group">
                <AccountMenuRow Icon={SettingsIcon} label="Settings" onPress={() => openSettings('general')} />
                <AccountMenuRow Icon={BellIcon} label="Notifications" onPress={() => openSettings('notifications')} />
                <AccountMenuRow Icon={UserIcon} label="Profile" onPress={() => openSettings('profile')} />
                <AccountMenuRow Icon={ShieldIcon} label="Account" onPress={() => openSettings('account')} />
              </div>

              <div className="zuri-account-group">
                <AccountMenuRow Icon={OverlayIcon} label="Quick ask" hint={QUICK_ASK_HINT} onPress={() => { setMenuOpen(false); void window.zuri?.overlay?.open?.(); }} />
                <AccountMenuRow Icon={theme === 'dark' ? SunIcon : MoonIcon} label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onPress={() => { setMenuOpen(false); onToggleTheme(); }} />
                <AccountMenuRow Icon={SignOutIcon} label="Sign out" onPress={() => void signOut()} />
              </div>
            </div>
          )}
          <button
            type="button"
            className="zuri-account-trigger"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account menu for ${accountName}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="zuri-avatar" aria-hidden="true">{initials}</span>
            <span className="zuri-account-identity">
              <span className="zuri-account-name">{accountName}</span>
              <span className="zuri-account-plan">{accountPlan}</span>
            </span>
            {dueReminders > 0 && <span aria-label={`${dueReminders} reminders due`} className="size-2 shrink-0 rounded-full bg-accent" />}
            <ChevronUpIcon size={15} className={`zuri-account-chevron${menuOpen ? ' is-open' : ''}`} />
          </button>
        </div>

        {/* The grab edge. A pointer drag, the arrow keys and a double click (back to the
            default) all work, so the width is reachable without a mouse too. */}
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            className={`zuri-sidebar-resizer${resizing ? ' is-dragging' : ''}`}
            title="Drag to resize. Double click to reset."
            onPointerDown={beginResize}
            onPointerMove={continueResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={resizeFromKeyboard}
            onDoubleClick={resetWidth}
          />
        )}
      </aside>
    </div>
  );
}
