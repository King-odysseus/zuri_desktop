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
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  MoonIcon,
  OverlayIcon,
  SunIcon,
  TaskIcon,
} from './Icons.jsx';

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

  useEffect(() => {
    let active = true;
    const loadThreads = async () => {
      const result = await window.zuri?.chats?.list?.();
      if (active && result?.ok) setThreads(Array.isArray(result.data) ? result.data : []);
    };
    // History writes happen outside this component, so follow main's shared
    // change event instead of leaving Recents stale until the next chat reply.
    const stopListening = window.zuri?.state?.onChanged?.((change) => {
      if (change?.area === 'chats') void loadThreads();
    });
    void loadThreads();
    return () => {
      active = false;
      stopListening?.();
    };
  }, [refreshKey]);
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
          </Button>
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
          {threads.map((thread) => (
            <Button
              key={thread.id}
              type="button"
              variant={thread.id === activeThreadId ? 'secondary' : 'ghost'}
              fullWidth
              className="mb-1 justify-start truncate rounded-lg px-2 py-2 text-left"
              onPress={() => onSelectThread(thread.id)}
            >
              {thread.title || 'New chat'}
            </Button>
          ))}
        </div>
      </aside>
    </div>
  );
}
