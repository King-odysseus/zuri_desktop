import { useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpIcon, ChevronDownIcon, MicIcon, PlusIcon } from './Icons.jsx';

const MODES = ['Ask', 'Act', 'Autopilot'];

const SUGGESTIONS = [
  'Which lines are over budget?',
  'Add a variance column to Budget.xlsx',
  'Schedule a Monday inbox brief',
  "Find last month's unpaid invoices",
];

// Layout follows the reference chat screen: a mode toggle centred at the top,
// the greeting and a single-line pill composer centred in the page, and the
// openings listed under the composer as one bordered card. Modes are the app's
// own Ask / Act / Autopilot rather than the reference's Chat / Work. Sending is
// not wired yet; this is the visual port.
export default function ChatPanel() {
  const [mode, setMode] = useState('Ask');
  const [draft, setDraft] = useState('');

  return (
    <main className="relative flex h-full flex-1 flex-col bg-background text-foreground">
      <div className="flex justify-center pt-6">
        <div
          role="group"
          aria-label="Mode"
          className="inline-flex rounded-full border border-border bg-surface-secondary p-1"
        >
          {MODES.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={mode === name ? 'secondary' : 'ghost'}
              className="rounded-full px-4"
              aria-pressed={mode === name}
              onPress={() => setMode(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <h1 className="mb-6 text-center text-3xl font-medium tracking-tight">
          What&rsquo;s on the agenda today?
        </h1>

        <div className="w-full max-w-2xl">
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 shadow-sm">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Attach a file">
              <PlusIcon />
            </Button>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Zuri"
              aria-label="Message Zuri"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
            />
            <button
              type="button"
              className="flex items-center gap-1 px-2 text-sm text-muted"
            >
              {mode}
              <ChevronDownIcon size={14} />
            </button>
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

          <div className="mt-3 rounded-2xl border border-border bg-background p-2">
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
