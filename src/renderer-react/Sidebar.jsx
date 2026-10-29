import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.jsx';
import {
  AgentIcon,
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
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  SkillsIcon,
  MoonIcon,
  OverlayIcon,
  SunIcon,
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
  { key: 'tasks', label: 'Tasks', Icon: TaskIcon },
  { key: 'reminders', label: 'Reminders', Icon: BellIcon },
  { key: 'automations', label: 'Automations', Icon: AutomationIcon },
  { key: 'images', label: 'Images', Icon: ImageIcon },
  { key: 'files', label: 'Files', Icon: FolderIcon },
  { key: 'features', label: 'Features', Icon: FeaturesIcon },
  { key: 'cloud', label: 'Zuri Cloud', Icon: CloudIcon },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

// One list, the way ChatGPT's sidebar is: New chat, Projects with their chats,
// Recents, and a Menu at the bottom that holds every other destination.
const MENU_ITEMS = NAV_ITEMS.filter(({ key }) => key !== 'chats');
export default function Sidebar({ current, onNavigate, onNewChat, onSelectThread, onEditProject = () => {}, activeThreadId, refreshKey, theme, onToggleTheme, collapsed = false, onToggleCollapsed = () => {} }) {
  const [threads, setThreads] = useState([]);
  const [projects, setProjects] = useState([]);
  // Which projects are open in the list, and which chat is choosing a project.
  const [openProjectIds, setOpenProjectIds] = useState([]);
  const [movingThreadId, setMovingThreadId] = useState('');
  // Reminders whose time has come and that are still open: what the bell counts.
  const [dueReminders, setDueReminders] = useState(0);
  // The bottom menu holds every destination that is not chat, so the list above it stays calm.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

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

  const projectIds = new Set(projects.map((project) => project.id));
  // A chat whose project is gone still shows in Recents instead of vanishing.
  const looseThreads = threads.filter((thread) => !projectIds.has(thread.projectId));

  function renderThread(thread) {
    return (
      <div key={thread.id} className="mb-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={thread.id === activeThreadId ? 'secondary' : 'ghost'}
            fullWidth
            className="min-w-0 flex-1 justify-start truncate rounded-lg px-2 py-2 text-left"
            onPress={() => onSelectThread(thread.id)}
          >
            {thread.title || 'New chat'}
          </Button>
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
        className={`zuri-sidebar-panel flex flex-col transition-[width] duration-200 ${collapsed ? 'w-0 overflow-hidden' : 'w-72'}`}
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
            <kbd className="ml-auto text-xs text-muted" aria-hidden="true">{NEW_CHAT_HINT}</kbd>
          </Button>
        </div>

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
        <div className="zuri-scrollbar-hidden max-h-64 overflow-y-auto px-3 text-sm text-muted">
          {projects.length === 0 && <p className="px-2">Keep one topic in one place. Create a project to group its chats.</p>}
          {projects.map((project) => {
            const ProjectIcon = projectIconFor(project.icon);
            const isOpen = openProjectIds.includes(project.id);
            const projectThreads = threads.filter((thread) => thread.projectId === project.id);
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
        <div className="zuri-scrollbar-hidden flex-1 overflow-y-auto px-3 text-sm text-muted">
          {threads.length === 0 && <p className="px-2">No conversations yet. Your threads will appear here, newest first.</p>}
          {looseThreads.map(renderThread)}
        </div>

        <div className="relative border-t border-border px-3 py-3" ref={menuRef}>
          {menuOpen && (
            <div role="menu" aria-label="More of Zuri" className="zuri-sidebar-menu absolute bottom-full left-3 right-3 mb-2 flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg">
              {MENU_ITEMS.map(({ key, label, Icon }) => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  className={`min-h-11 justify-start gap-3 rounded-lg px-3 font-normal ${current === key ? 'zuri-selected-pill' : ''}`}
                  aria-current={current === key ? 'page' : undefined}
                  onPress={() => { setMenuOpen(false); onNavigate(key); }}
                >
                  <Icon size={16} />
                  {label}
                  {key === 'reminders' && dueReminders > 0 && (
                    <span className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold leading-5 text-accent-foreground">{dueReminders > 9 ? '9+' : dueReminders}</span>
                  )}
                </Button>
              ))}
              <Button type="button" variant="ghost" role="menuitem" className="min-h-11 justify-start gap-3 rounded-lg px-3 font-normal" onPress={() => { setMenuOpen(false); void window.zuri?.overlay?.open?.(); }}>
                <OverlayIcon size={16} />
                Quick ask
              </Button>
              <Button type="button" variant="ghost" role="menuitem" className="min-h-11 justify-start gap-3 rounded-lg px-3 font-normal" onPress={() => { setMenuOpen(false); onToggleTheme(); }}>
                {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            fullWidth
            className="min-h-11 justify-start gap-3 rounded-xl px-3 font-normal"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPress={() => setMenuOpen((open) => !open)}
          >
            <SettingsIcon size={16} />
            Menu
            {dueReminders > 0 && <span aria-label={`${dueReminders} reminders due`} className="ml-auto size-2 rounded-full bg-accent" />}
          </Button>
        </div>
      </aside>
    </div>
  );
}
