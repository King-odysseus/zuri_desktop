import { useEffect, useState } from 'react';
import { Button, Chip, DateField, Input, NumberField, TimeField } from './ui.jsx';
import SelectField from './SelectField.jsx';

const REPEAT_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'interval', label: 'Every few minutes' },
  { value: 'daily', label: 'Every day' },
];

const GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
];

// Defaults to five minutes out, matching the legacy form (views/reminders.js).
function defaultWhen() {
  const date = new Date(Date.now() + 5 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDue(iso, timeOnly = false) {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  return due.toLocaleString([], timeOnly ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' });
}

function describeRowDue(iso, groupKey) {
  const due = formatDue(iso, groupKey === 'today');
  if (!due) return 'Due time unknown';
  return groupKey === 'overdue' ? `Was due ${due}` : `Due ${due}`;
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

// Every reminder lands in exactly one time frame so the page can show them in a
// fixed order. A due date that cannot be parsed stays visible under Upcoming
// instead of disappearing from the list.
function groupByDueTime(reminders) {
  const now = Date.now();
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(24, 0, 0, 0);

  const buckets = { overdue: [], today: [], upcoming: [] };
  for (const reminder of reminders) {
    const dueMs = Date.parse(reminder.dueAt);
    if (!Number.isFinite(dueMs)) buckets.upcoming.push(reminder);
    else if (dueMs <= now) buckets.overdue.push(reminder);
    else if (dueMs < startOfTomorrow.getTime()) buckets.today.push(reminder);
    else buckets.upcoming.push(reminder);
  }

  return GROUPS.map((group) => ({ ...group, items: buckets[group.key] })).filter(
    (group) => group.items.length > 0,
  );
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

  const groups = groupByDueTime(upcoming);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <header>
            <h1 className="text-2xl font-medium tracking-tight">Reminders</h1>
            <p className="mt-1 text-sm text-muted">Follow-ups that come back when they are due.</p>
          </header>

          <form
            onSubmit={addReminder}
            className="zuri-reminders-form grid w-full items-end gap-3 sm:grid-cols-2"
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Call the bank"
              aria-label="What is it for"
              className="min-w-0 sm:col-span-2"
            />
            <DateField
              label="Date"
              value={when.slice(0, 10)}
              onChange={(date) => setWhen(combineDateTime(date, when.slice(11, 16)))}
              className="min-w-0"
            />
            <TimeField
              label="Time"
              value={when.slice(11, 16)}
              onChange={(time) => setWhen(combineDateTime(when.slice(0, 10), time))}
              className="w-full"
            />
            <SelectField label="How often" value={repeat} options={REPEAT_OPTIONS} onChange={setRepeat} />
            {repeat === 'interval' && (
              <NumberField
                min="1"
                step="1"
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.target.value)}
                aria-label="Minutes between reminders"
                className="w-32"
              />
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-self-start sm:w-auto"
              isDisabled={!api || saving}
            >
              Add
            </Button>
          </form>

          {message !== '' && (
            <p role="status" className="text-sm text-muted">
              {message}
            </p>
          )}

          {status === 'loading' && <p className="text-sm text-muted">Loading reminders...</p>}

          {status === 'error' && (
            <p className="zuri-notice text-sm text-info">
              Your reminders only appear in the Zuri app, not in this preview.
            </p>
          )}

          {status === 'ready' && groups.length === 0 && (
            <div className="zuri-empty-state">
              <strong>Nothing coming up</strong>
              <p>Add a reminder above and Zuri will bring it back when it is due.</p>
            </div>
          )}

          {status === 'ready' &&
            groups.map((group) => (
              <section key={group.key}>
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-sm font-medium text-muted">{group.label}</h2>
                  <Chip size="sm">{group.items.length}</Chip>
                </div>
                <ul className="zuri-reminder-list flex flex-col divide-y divide-border border-t border-border">
                  {group.items.map((reminder) => (
                    <li key={reminder.id} className="flex items-center gap-3 py-3">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{reminder.title}</span>
                        <span className="text-xs text-muted">
                          {describeRowDue(reminder.dueAt, group.key)} - {describeRepeat(reminder)}
                        </span>
                      </div>
                      {group.key === 'overdue' && (
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
                  ))}
                </ul>
              </section>
            ))}
        </div>
      </div>
    </main>
  );
}
