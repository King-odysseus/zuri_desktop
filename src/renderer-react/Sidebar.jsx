import { Button } from '@heroui/react';
import {
  AgentIcon,
  AutomationIcon,
  BellIcon,
  ChatIcon,
  ChevronDownIcon,
  EditIcon,
  FolderIcon,
  SearchIcon,
  SettingsIcon,
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
export default function Sidebar({ current, onNavigate }) {
  return (
    <div className="flex h-full shrink-0">
      <nav
        className="flex w-12 flex-col items-center gap-1 border-r border-border bg-background py-3"
        aria-label="Destinations"
      >
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <Button
            key={key}
            isIconOnly
            size="sm"
            variant={current === key ? 'secondary' : 'ghost'}
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
        className="flex w-64 flex-col bg-surface-secondary text-foreground"
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <button
            type="button"
            className="flex items-center gap-1 text-lg font-semibold tracking-tight"
          >
            Zuri
            <ChevronDownIcon size={14} />
          </button>
          <div className="flex items-center gap-1 text-muted">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Notifications">
              <BellIcon size={16} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Search">
              <SearchIcon size={16} />
            </Button>
          </div>
        </div>

        <div className="px-2">
          <Button
            variant="ghost"
            fullWidth
            className="justify-start gap-2 font-normal"
            onPress={() => onNavigate('chats')}
          >
            <EditIcon size={16} />
            New chat
          </Button>
        </div>

        <p className="px-4 pb-1 pt-5 text-sm text-muted">Recents</p>
        <div className="flex-1 overflow-y-auto px-4 text-sm text-muted">
          No conversations yet. Your threads will appear here, newest first.
        </div>
      </aside>
    </div>
  );
}
