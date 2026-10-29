import { Button } from './ui.jsx';
import {
  AgentIcon,
  AutomationIcon,
  BellIcon,
  ChatIcon,
  ChevronRightIcon,
  FolderIcon,
  MicIcon,
  SearchIcon,
  SettingsIcon,
  UserPlusIcon,
  TaskIcon,
} from './Icons.jsx';

const FEATURES = [
  { route: 'chats', label: 'Chat', Icon: ChatIcon, description: 'Ask questions, draft replies and think things through. Answers stream in, with copyable code and tables. Stop a reply at any time.' },
  { route: 'chats', label: 'Voice and attachments', Icon: MicIcon, description: 'Dictate a message with the microphone, or attach a PDF, Word, Excel, PowerPoint, text, CSV, Markdown or JSON file.' },
  { route: 'agents', label: 'Agents', Icon: AgentIcon, description: 'Create assistants with their own instructions, then pick one for the job at hand.' },
  { route: 'tasks', label: 'Tasks', Icon: TaskIcon, description: 'Plan and track work that needs doing.' },
  { route: 'reminders', label: 'Reminders', Icon: BellIcon, description: 'Keep important follow-ups on schedule, with desktop notifications you can snooze.' },
  { route: 'automations', label: 'Automations', Icon: AutomationIcon, description: 'Run recurring research and desktop tasks on a schedule, including ones you missed while the app was closed.' },
  { route: 'files', label: 'Files', Icon: FolderIcon, description: 'Open, review and summarise files in your workspace folder.' },
  { route: 'search', label: 'Search', Icon: SearchIcon, description: 'Find anything you said or Zuri replied in any saved conversation.' },
  { route: 'settings', label: 'Settings', Icon: SettingsIcon, description: 'Choose the AI provider and model, add your own keys, switch theme and turn on the floating quick-ask window.' },
  { route: 'cloud', label: 'Zuri Cloud account', Icon: UserPlusIcon, description: 'Sign in with Gmail or a verified Google Workspace account, view usage and manage your plan.' },
];

export default function FeaturesView({ onNavigate }) {
  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="max-w-2xl pb-8">
          <header className="pb-6">
            <h1 className="text-2xl font-medium tracking-tight">What Zuri can do</h1>
            <p className="mt-1 text-sm text-muted">Everything in one place. Open any feature to start using it.</p>
          </header>
          {/* A single hairline list: each row is a whole-width button, so the
              target stays large without a box around every feature. */}
          <section aria-label="Features" className="divide-y divide-border border-y border-border">
            {FEATURES.map(({ route, label, description, Icon }) => (
              <Button key={label} variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-1 py-3 text-left" onPress={() => onNavigate?.(route)}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted">
                  <Icon size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="text-sm font-medium leading-tight text-foreground">{label}</span>
                  <span className="w-full whitespace-normal text-xs font-normal text-muted">{description}</span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 self-center text-muted" />
              </Button>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
