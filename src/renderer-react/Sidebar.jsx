import { useEffect, useState } from 'react';
import { Button } from './ui.jsx';
import {
  AgentIcon,
  AutomationIcon,
  BellIcon,
  ChatIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EditIcon,
  FolderIcon,
  SearchIcon,
  SettingsIcon,
  MoonIcon,
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
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

// The reference app pairs a narrow icon rail (where you are) with a list panel
// (what you have). The rail carries the seven destinations; the panel is the
// conversation list, which routing in App.jsx keeps in step with the rail.
export default function Sidebar({ current, onNavigate, onNewChat, onSelectThread, activeThreadId, refreshKey, theme, onToggleTheme }) {
  const [collapsed, setCollapsed] = useState(false);
  const [threads, setThreads] = useState([]);

  useEffect(() => {
    let active = true;
    const loadThreads = async () => {
      const result = await window.zuri?.chats?.list?.();
      if (active && result?.ok) setThreads(Array.isArray(result.data) ? result.data : []);
    };
    void loadThreads();
    return () => { active = false; };
  }, [refreshKey]);
  return (
    <div className="flex h-full shrink-0">
      <nav
        className="flex w-14 flex-col items-center gap-2 border-r border-border bg-background py-4"
        aria-label="Destinations"
      >
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <Button
            key={key}
            isIconOnly
            size="sm"
            variant="ghost"
            className={current === key ? 'bg-surface-tertiary text-foreground' : 'text-muted'}
            aria-label={label}
            title={label}
            aria-current={current === key ? 'page' : undefined}
            onPress={() => onNavigate(key)}
          >
            <Icon />
          </Button>
        ))}
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="mt-auto text-muted"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onPress={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </nav>

      <aside
        className={`flex flex-col bg-surface-secondary text-foreground transition-[width] duration-200 ${collapsed ? 'w-0 overflow-hidden' : 'w-72'}`}
        aria-label="Conversations"
        aria-hidden={collapsed}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <Button type="button" variant="ghost" className="flex items-center gap-1 text-lg font-semibold tracking-tight">
            Zuri
            <ChevronDownIcon size={14} />
          </Button>
          <div className="flex items-center gap-1 text-muted">
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
            className="justify-start gap-2 font-normal"
            onPress={onNewChat}
          >
            <EditIcon size={16} />
            New chat
          </Button>
        </div>

        <p className="px-5 pb-2 pt-6 text-xs font-medium uppercase tracking-wide text-muted">Recents</p>
        <div className="flex-1 overflow-y-auto px-3 text-sm text-muted">
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
