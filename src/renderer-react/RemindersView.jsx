import { useEffect, useState } from 'react';
import { Button, Chip, DateField, Input } from './ui.jsx';
import SelectField from './SelectField.jsx';

const REPEAT_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'interval', label: 'Every few minutes' },
  { value: 'daily', label: 'Every day' },
];

// Defaults to five minutes out, matching the legacy form (views/reminders.js).
function defaultWhen() {
  const date = new Date(Date.now() + 5 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeDue(iso) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function describeRepeat(reminder) {
  if (reminder.repeat === 'interval') {
    return `Every ${reminder.intervalMinutes ?? 60} minutes`;
  }
  if (reminder.repeat === 'daily') return `Daily at ${reminder.timeOfDay ?? 'the saved time'}`;
  return 'Once';
}

function combineDateTime(date, time) {
  return `${date}T${time}`;
}

// Port of the legacy Reminders destination on the same window.zuri.reminders
// calls (list, create, complete), so a reminder made here is the same
// reminders.json row. Repeat gaps and snooze are not ported yet.
export default function RemindersView() {
  const [reminders, setReminders] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(defaultWhen);
  const [repeat, setRepeat] = useState('once');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const api = typeof window !== 'undefined' ? window.zuri?.reminders : undefined;

  async function reload() {
    if (!api) {
      setStatus('error');
      return;
    }
    try {
      const result = await api.list();
      if (!result?.ok) {
        setStatus('error');
        return;
      }
      setReminders(Array.isArray(result.data) ? result.data : []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addReminder(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setMessage('Give the reminder a title first.');
      return;
    }
    const dueAt = new Date(when);
    if (Number.isNaN(dueAt.getTime())) {
      setMessage('Pick a date and time for the reminder.');
      return;
    }
    const payload = { title: trimmed, repeat, dueAt: dueAt.toISOString() };
    if (repeat === 'interval') {
      const minutes = Number(intervalMinutes);
      if (!Number.isFinite(minutes) || minutes < 1) {
        setMessage('The gap between reminders must be at least one minute.');
        return;
      }
      payload.intervalMinutes = Math.floor(minutes);
    }
    setSaving(true);
    try {
      const saved = await api.create(payload);
      if (!saved?.ok) {
        setMessage(saved?.error?.message ?? 'The reminder was not saved.');
        return;
      }
      setTitle('');
      setWhen(defaultWhen());
      setRepeat('once');
      setIntervalMinutes('60');
      setMessage('Reminder saved.');
      await reload();
    } catch (error) {
      setMessage(error?.message ?? 'The reminder was not saved.');
    } finally {
      setSaving(false);
    }
  }

  async function complete(reminder) {
    try {
      const done = await api.complete({ id: reminder.id });
      if (!done?.ok) {
        setMessage(done?.error?.message ?? 'That reminder could not be marked done.');
        return;
      }
      await reload();
    } catch (error) {
      setMessage(error?.message ?? 'That reminder could not be marked done.');
    }
  }

  useEffect(() => {
    const unsubscribe = window.zuri?.state?.onChanged?.((change) => {
      if (change?.area === 'reminders') void reload();
    });
    return () => unsubscribe?.();
    // The bridge object is stable for the lifetime of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upcoming = reminders
    .filter((reminder) => !reminder.completedAt && reminder.status !== 'done')
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  return (
    <main className="flex h-full flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <h1 className="mb-6 text-3xl font-medium tracking-tight">Reminders</h1>

        <form onSubmit={addReminder} className="zuri-reminders-form mb-2 grid w-full items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1.5fr)_minmax(12rem,1fr)_minmax(10rem,0.9fr)_minmax(11rem,1fr)_auto]">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Call the bank"
            aria-label="What is it for"
            className="min-w-0"
          />
          <DateField
            label="Date"
            value={when.slice(0, 10)}
            onChange={(date) => setWhen(combineDateTime(date, when.slice(11, 16)))}
            className="min-w-0"
          />
          <Input
            type="time"
            label="Time"
            value={when.slice(11, 16)}
            onChange={(event) => setWhen(combineDateTime(when.slice(0, 10), event.target.value))}
            className="w-full"
          />
          <SelectField label="How often" value={repeat} options={REPEAT_OPTIONS} onChange={setRepeat} />
          {repeat === 'interval' && (
            <Input
              type="number"
              min="1"
              step="1"
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              aria-label="Minutes between reminders"
              className="w-32"
            />
          )}
          <Button type="submit" variant="primary" className="w-full sm:w-auto" isDisabled={!api || saving}>
            Add
          </Button>
        </form>
        <p role="status" className="mb-6 min-h-5 text-sm text-muted">
          {message}
        </p>

        {status === 'loading' && <p className="text-sm text-muted">Loading reminders...</p>}
        {status === 'error' && (
          <p className="text-sm text-muted">
            Reminder data is only available when this page runs inside the Zuri app, not the
            browser preview.
          </p>
        )}
        {status === 'ready' && upcoming.length === 0 && (
          <p className="zuri-empty-state text-sm text-muted">Nothing coming up.</p>
        )}
        {status === 'ready' && (
          <ul className="zuri-reminder-list flex flex-col gap-2">
            {upcoming.map((reminder) => {
              const overdue = Date.parse(reminder.dueAt) <= Date.now();
              return (
                <li
                  key={reminder.id}
                  className="flex items-center gap-3 rounded-xl border border-border px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{reminder.title}</span>
                    <span className="text-xs text-muted">
                      {overdue ? `Overdue - was due ${describeDue(reminder.dueAt)}` : `Due ${describeDue(reminder.dueAt)}`}
                      {' - '}
                      {describeRepeat(reminder)}
                    </span>
                  </div>
                  {overdue && (
                    <Chip size="sm" color="danger">
                      Overdue
                    </Chip>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Mark ${reminder.title} done`}
                    onPress={() => complete(reminder)}
                  >
                    Done
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
