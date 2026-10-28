import { useEffect, useState } from 'react';
import { Button } from './ui.jsx';
import {
  AgentIcon,
  AutomationIcon,
  BellIcon,
  ChatIcon,
  CloudIcon,
  ChevronDownIcon,
  EditIcon,
  FeaturesIcon,
  HistoryIcon,
  FolderIcon,
  FolderPlusIcon,
  DeleteIcon,
  ChevronRightIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  MoonIcon,
  OverlayIcon,
  SunIcon,
  TaskIcon,
} from './Icons.jsx';
import { projectIconFor } from './projectIcons.js';

export const NAV_ITEMS = [
  { key: 'chats', label: 'Chats', Icon: ChatIcon },
  { key: 'agents', label: 'Agents', Icon: AgentIcon },
  { key: 'tasks', label: 'Tasks', Icon: TaskIcon },
  { key: 'reminders', label: 'Reminders', Icon: BellIcon },
  { key: 'automations', label: 'Automations', Icon: AutomationIcon },
  { key: 'files', label: 'Files', Icon: FolderIcon },
  { key: 'features', label: 'Features', Icon: FeaturesIcon },
  { key: 'cloud', label: 'Zuri Cloud', Icon: CloudIcon },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

// The reference app pairs a narrow icon rail (where you are) with a list panel
// (what you have). The rail carries the eight destinations; the panel is the
// conversation list, which routing in App.jsx keeps in step with the rail.
export default function Sidebar({ current, onNavigate, onNewChat, onSelectThread, activeThreadId, refreshKey, theme, onToggleTheme, collapsed = false, onToggleCollapsed = () => {} }) {
  const [threads, setThreads] = useState([]);
  const [projects, setProjects] = useState([]);
  // Which projects are open in the list, and which chat is choosing a project.
  const [openProjectIds, setOpenProjectIds] = useState([]);
  const [movingThreadId, setMovingThreadId] = useState('');

  useEffect(() => {
    let active = true;
    const loadThreads = async () => {
      const result = await window.zuri?.chats?.list?.();
      if (active && result?.ok) setThreads(Array.isArray(result.data) ? result.data : []);
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
    });
    void loadThreads();
    void loadProjects();
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
      <nav
        className="zuri-sidebar-rail flex w-14 flex-col items-center gap-2 border-r border-border py-4"
        aria-label="Destinations"
      >
        {/* The chat view carries this control as a floating button over the
            conversation, so the rail only repeats it where that one is absent. */}
        {collapsed && current !== 'chats' && (
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="text-muted"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onPress={() => onToggleCollapsed(false)}
          >
            <PanelLeftOpenIcon />
          </Button>
        )}
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <Button
            key={key}
            isIconOnly
            size="sm"
            variant="ghost"
            className={current === key || (key === 'chats' && current === 'history') ? 'zuri-selected-pill' : 'text-muted'}
            aria-label={label}
            title={label}
            aria-current={current === key ? 'page' : undefined}
            onPress={() => onNavigate(key)}
          >
            <Icon />
          </Button>
        ))}
      </nav>

      <aside
        className={`zuri-sidebar-panel flex flex-col transition-[width] duration-200 ${collapsed ? 'w-0 overflow-hidden' : 'w-72'}`}
        aria-label="Conversations"
        aria-hidden={collapsed}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Button type="button" variant="ghost" className="flex items-center gap-1 text-lg font-semibold tracking-tight">
            Zuri
            <ChevronDownIcon size={14} />
          </Button>
          <div className="flex items-center gap-1 text-muted">
            {/* On the chat view the same control floats over the conversation, so
                keeping a second copy here would give the person two toggles. */}
            {current !== 'chats' && (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                onPress={() => onToggleCollapsed(true)}
              >
                <PanelLeftCloseIcon size={17} />
              </Button>
            )}
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Open quick ask overlay"
              title="Quick ask overlay"
              onPress={() => void window.zuri?.overlay?.open?.()}
            >
              <OverlayIcon size={16} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Notifications">
              <BellIcon size={16} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Search conversations" onPress={() => onNavigate('search')}>
              <SearchIcon size={16} />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onPress={onToggleTheme}
            >
              {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </Button>
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
            <kbd className="ml-auto text-xs text-muted" aria-hidden="true">Ctrl K</kbd>
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
      </aside>
    </div>
  );
}
