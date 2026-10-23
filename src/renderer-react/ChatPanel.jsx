import { useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpIcon, MicIcon, PlusIcon } from './Icons.jsx';
import SelectField from './SelectField.jsx';

const MODES = ['Ask', 'Act', 'Autopilot'].map((name) => ({ value: name, label: name }));

const SUGGESTIONS = [
  'Which lines are over budget?',
  'Add a variance column to Budget.xlsx',
  'Schedule a Monday inbox brief',
  "Find last month's unpaid invoices",
];

const WORKSPACE_MODES = [
  { value: 'chat', label: 'Chat' },
  { value: 'work', label: 'Work' },
];

// Layout follows the reference chat screen: one compact workspace control at the top,
// the greeting and a single-line pill composer centred in the page, and the
// openings listed under the composer as one bordered card. Keeping assistant
// mode choice in one compact HeroUI control leaves the composer calm.
export default function ChatPanel() {
  const [mode, setMode] = useState('Ask');
  const [workspaceMode, setWorkspaceMode] = useState('chat');
  const [draft, setDraft] = useState('');

  return (
    <main className="relative flex h-full flex-1 flex-col bg-background text-foreground">
      <div className="flex justify-center px-4 pt-6">
        <div role="tablist" aria-label="Workspace mode" className="inline-flex rounded-full border border-border bg-surface-secondary p-1 shadow-sm">
          {WORKSPACE_MODES.map(({ value, label }) => (
            <Button
              key={value}
              role="tab"
              size="sm"
              variant={workspaceMode === value ? 'secondary' : 'ghost'}
              aria-selected={workspaceMode === value}
              className="min-w-20 rounded-full px-4"
              onPress={() => setWorkspaceMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <h1 className="mb-6 text-center text-3xl font-medium tracking-tight">
          {workspaceMode === 'work' ? 'What should we work on?' : 'What&rsquo;s on the agenda today?'}
        </h1>

        <div className="w-full max-w-2xl">
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 shadow-sm">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Attach a file">
              <PlusIcon />
            </Button>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={workspaceMode === 'work' ? 'Work with Zuri' : 'Ask Zuri'}
              aria-label="Message Zuri"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
            />
            <SelectField
              label="Assistant mode"
              value={mode}
              options={MODES}
              onChange={setMode}
              hideLabel
              className="min-w-0 w-28 shrink-0"
            />
            <Button isIconOnly size="sm" variant="ghost" aria-label="Dictate">
              <MicIcon />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="primary"
              className="rounded-full"
              aria-label="Send"
              isDisabled={draft.trim() === ''}
            >
              <ArrowUpIcon />
            </Button>
          </div>

          <div className="mt-3 rounded-2xl border border-border bg-surface-secondary p-2">
            <p className="px-3 pb-1 pt-2 text-sm text-muted">Try one of these</p>
            {SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                variant="ghost"
                fullWidth
                className="justify-start font-normal"
                onPress={() => setDraft(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
