import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, IconButton, InlineAlert } from '../components/ui.jsx';
import { BellIcon, CheckIcon, DeleteIcon, PlusIcon } from '../components/Icons.jsx';
import { createReminder, deleteReminder, listReminders, updateReminder } from '../lib/api.js';

const TITLE_MAX_LENGTH = 200;
const INTERVAL_MAX_MINUTES = 10080;

const REPEATS = [
  { value: 'once', label: 'Once' },
  { value: 'interval', label: 'Every few minutes' },
  { value: 'daily', label: 'Every day' },
];

/**
 * A datetime-local field has no zone and no seconds: it is the wall clock on this
 * device. Writing it with toISOString would answer in UTC and land the input an
 * hour or two off in either direction, so the parts are formatted by hand.
 */
function localInputValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The next whole hour: a reminder is set for later, never for a moment already gone. */
function nextHourInput() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return localInputValue(date);
}

/** '2026-11-02T09:00' into '09:00', which is the daily time the server stores. */
function timeOfDayFrom(value) {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(String(value ?? '').trim());
  return match ? match[1] : '';
}

/** The person's own clock and language: a reminder is read against their day. */
function dueLabel(dueAt) {
  const date = new Date(dueAt ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dueTime(dueAt) {
  const date = new Date(dueAt ?? '');
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * The repeat in the words a person would use. It is read mid-sentence, next to the
 * time, so it stays lowercase: "2 Nov 2026, 09:00 (every 30 minutes)".
 */
function repeatLabel(reminder) {
  const repeat = String(reminder?.repeat ?? 'once').toLowerCase();
  if (repeat === 'interval') {
    const minutes = Math.round(Number(reminder?.intervalMinutes));
    if (!Number.isFinite(minutes) || minutes <= 0) return 'repeats on an interval';
    return `every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (repeat === 'daily') {
    const time = String(reminder?.timeOfDay ?? '').trim();
    return /^\d{1,2}:\d{2}$/.test(time) ? `daily at ${time}` : 'daily';
  }
  return 'once';
}

/** A row is named by its own words, and one saved without a title still needs a name. */
function nameOf(reminder) {
  const title = String(reminder?.title ?? '').trim();
  return title === '' ? 'this reminder' : title;
}

export default function RemindersView() {
  const [reminders, setReminders] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState(nextHourInput);
  const [repeat, setRepeat] = useState('once');
  const [intervalMinutes, setIntervalMinutes] = useState('30');
  const [adding, setAdding] = useState(false);
  // One id at a time: a second press on a row that is already waiting would send
  // two writes for the same reminder and the answers could arrive out of order.
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      setReminders(await listReminders());
      setStatus('ready');
    } catch (error) {
      // The server names what went wrong, so its sentence is shown rather than a
      // generic one.
      setLoadError(error?.message || 'Your reminders could not be loaded.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Open reminders first, soonest at the top: the next thing to go off is the one
  // worth seeing. A reminder already ticked off falls to the bottom as a record.
  const ordered = useMemo(
    () => [...reminders].sort((a, b) => {
      if (Boolean(a?.done) !== Boolean(b?.done)) return a?.done ? 1 : -1;
      return dueTime(a?.dueAt) - dueTime(b?.dueAt);
    }),
    [reminders],
  );
  const openCount = ordered.filter((reminder) => !reminder.done).length;

  const add = useCallback(
    async (event) => {
      event.preventDefault();
      const text = title.trim();
      if (text === '' || adding) return;
      // The field is read as local time by the browser, and the server stores the
      // same moment as an ISO string, so the reminder keeps its zone.
      const when = new Date(dueAt);
      if (Number.isNaN(when.getTime())) {
        setActionError('Choose the date and time for this reminder.');
        return;
      }
      if (repeat === 'interval' && !(Number(intervalMinutes) > 0)) {
        setActionError('Say how many minutes apart the reminder should repeat.');
        return;
      }
      setAdding(true);
      setActionError('');
      try {
        const reminder = await createReminder({
          title: text,
          dueAt: when.toISOString(),
          repeat,
          // Only the field the chosen repeat actually uses is sent, so a once-only
          // reminder never carries a leftover interval from an earlier choice.
          ...(repeat === 'interval' ? { intervalMinutes: Number(intervalMinutes) } : {}),
          ...(repeat === 'daily' ? { timeOfDay: timeOfDayFrom(dueAt) } : {}),
        });
        if (reminder?.id) {
          setReminders((rows) => [reminder, ...rows]);
        } else {
          await load();
        }
        setTitle('');
        setDueAt(nextHourInput());
        setRepeat('once');
        setIntervalMinutes('30');
      } catch (error) {
        setActionError(error?.message || 'That reminder could not be saved.');
      } finally {
        setAdding(false);
      }
    },
    [adding, dueAt, intervalMinutes, load, repeat, title],
  );

  const toggle = useCallback(
    async (reminder) => {
      if (!reminder?.id || busyId !== '') return;
      setBusyId(reminder.id);
      setActionError('');
      try {
        const updated = await updateReminder(reminder.id, { done: !reminder.done });
        // The server owns what done means for a repeating reminder, so its copy wins
        // when it sends one; a bare answer still flips the row locally.
        setReminders((rows) => rows.map((row) => (row.id === reminder.id
          ? { ...row, ...(updated?.id ? updated : { done: !reminder.done }) }
          : row)));
      } catch (error) {
        setActionError(error?.message || 'That reminder could not be changed.');
      } finally {
        setBusyId('');
      }
    },
    [busyId],
  );

  const remove = useCallback(
    async (reminder) => {
      if (!reminder?.id || busyId !== '') return;
      setBusyId(reminder.id);
      setActionError('');
      try {
        await deleteReminder(reminder.id);
        setReminders((rows) => rows.filter((row) => row.id !== reminder.id));
        setConfirmId('');
      } catch (error) {
        setActionError(error?.message || 'That reminder could not be deleted.');
      } finally {
        setBusyId('');
      }
    },
    [busyId],
  );

  return (
    <section className="view reminder-view">
      <div className="view-head">
        <div>
          <h1>Reminders</h1>
          <p>
            Everything Zuri is set to bring up again. Ask for one in any chat, or set it here, and it
            shows up on every device you sign in on.
          </p>
        </div>
      </div>

      {status === 'error' && <InlineAlert tone="danger">{loadError}</InlineAlert>}

      <form className="card project-form" onSubmit={(event) => void add(event)}>
        <p className="project-form-title">Set a reminder</p>
        <div className="task-form-grid">
          <div className="project-field">
            <label className="project-field-label" htmlFor="reminder-new-title">
              What should Zuri bring up
            </label>
            <input
              id="reminder-new-title"
              className="project-input"
              maxLength={TITLE_MAX_LENGTH}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Call the supplier"
            />
          </div>
          <div className="project-field">
            <label className="project-field-label" htmlFor="reminder-new-due">
              When
            </label>
            <input
              id="reminder-new-due"
              className="project-input"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
          <div className="project-field">
            <label className="project-field-label" htmlFor="reminder-new-repeat">
              How often
            </label>
            <select
              id="reminder-new-repeat"
              className="project-input"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            >
              {REPEATS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {repeat === 'interval' && (
          <div className="project-field reminder-interval-field">
            <label className="project-field-label" htmlFor="reminder-new-interval">
              Minutes apart
            </label>
            <input
              id="reminder-new-interval"
              className="project-input"
              type="number"
              min="1"
              max={INTERVAL_MAX_MINUTES}
              step="1"
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
            />
          </div>
        )}

        <p className="project-form-note">
          {repeat === 'daily'
            ? 'Goes off every day at the time in the field above.'
            : repeat === 'interval'
              ? 'Goes off at the time above, then again every interval you set.'
              : 'Goes off once, at the time above.'}
        </p>

        {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}

        <div className="project-form-actions">
          {/* A blank title is not a reminder, so the button stays off until there is one. */}
          <Button type="submit" disabled={adding || title.trim() === ''}>
            <PlusIcon size={14} aria-hidden="true" />
            {adding ? 'Saving...' : 'Set reminder'}
          </Button>
        </div>
      </form>

      {status === 'loading' && <p className="project-loading">Loading your reminders...</p>}

      {status === 'ready' && (
        <article className="card project-section">
          <div className="project-section-head">
            <h2 className="project-section-title">Your reminders</h2>
            <span className="project-section-note">
              {ordered.length === 0 ? 'Nothing yet' : `${openCount} open, ${ordered.length - openCount} done`}
            </span>
          </div>

          {ordered.length === 0 ? (
            <div className="reminder-empty">
              <span className="reminder-empty-icon">
                <BellIcon size={18} aria-hidden="true" />
              </span>
              <p className="reminder-empty-title">No reminders yet</p>
              <p className="reminder-empty-note">
                Ask Zuri to remind you in any chat, this one included: name the thing and the time, and
                it appears here. The form above does the same by hand.
              </p>
            </div>
          ) : (
            <ul className="reminder-list">
              {ordered.map((reminder) => {
                const name = nameOf(reminder);
                const when = dueLabel(reminder.dueAt);
                const repeatText = repeatLabel(reminder);
                return (
                  <li key={reminder.id} className={reminder.done ? 'reminder-row is-done' : 'reminder-row'}>
                    <IconButton
                      label={reminder.done ? `Mark ${name} as not done` : `Mark ${name} as done`}
                      size="sm"
                      className="reminder-tick"
                      aria-pressed={Boolean(reminder.done)}
                      disabled={busyId === reminder.id}
                      onClick={() => void toggle(reminder)}
                    >
                      {reminder.done && <CheckIcon size={14} aria-hidden="true" />}
                    </IconButton>

                    <span className="reminder-row-body">
                      <span className="reminder-row-title">{name}</span>
                      <span className="reminder-row-meta">
                        <span className="reminder-row-date">
                          {when === '' ? repeatText : `${when} (${repeatText})`}
                        </span>
                        {reminder.done && <span className="reminder-row-done">Done</span>}
                      </span>
                    </span>

                    <span className="reminder-row-actions">
                      <IconButton
                        label={`Delete ${name}`}
                        tone="danger"
                        size="sm"
                        disabled={busyId === reminder.id}
                        onClick={() => {
                          setConfirmId(reminder.id);
                          setActionError('');
                        }}
                      >
                        <DeleteIcon size={14} aria-hidden="true" />
                      </IconButton>
                    </span>

                    {confirmId === reminder.id && (
                      // Asked in the row itself rather than in a browser dialog, so the
                      // wording matches the rest of the page and a phone never blocks.
                      <span className="reminder-confirm" role="group" aria-label={`Delete ${name}?`}>
                        <span className="reminder-confirm-note">Delete this reminder?</span>
                        <Button
                          variant="ghost"
                          className="task-confirm-delete"
                          disabled={busyId === reminder.id}
                          onClick={() => void remove(reminder)}
                        >
                          Delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmId('')}>
                          Keep
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      )}
    </section>
  );
}
