import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, DateTimeField, IconButton, InlineAlert, Input, NumberField, Select, Textarea, TimeField } from '../components/ui.jsx';
import { AutomationIcon, DeleteIcon, PlusIcon } from '../components/Icons.jsx';
// The schedule sentence is the one the chat card uses, read back out of the card
// rather than written again here, so "Every day at 07:00" cannot come to mean two
// different things on one screen. describeNotable is the only export that knows it.
import { describeNotable } from '../../../src/shared/notableActions.js';
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
} from '../lib/api.js';

const PROMPT_MAX_LENGTH = 2000;
const INTERVAL_MAX_MINUTES = 10080;

const CADENCES = [
  { value: 'daily', label: 'Every day' },
  { value: 'interval', label: 'Every few hours or minutes' },
  { value: 'once', label: 'Once' },
];

/**
 * A datetime-local field has no zone and no seconds: it is the wall clock on this
 * device. Writing it with toISOString would answer in UTC and land the run an hour
 * or two off in either direction, so the parts are formatted by hand.
 */
function localInputValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The next whole hour: an automation is set for later, never for a moment already gone. */
function nextHourInput() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return localInputValue(date);
}

/** The person's own clock and language: a run is read against their day. */
function momentLabel(value) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function momentTime(value) {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/**
 * "Every day at 07:00", "Every 30 minutes", "Once, on 3 Nov at 09:00".
 * The shared card writes exactly those words under the label "Runs", so that line
 * is lifted from it. A record the card cannot describe still needs a sentence, and
 * the plain one says what little is known rather than nothing at all.
 */
function cadenceLabel(automation) {
  const card = describeNotable('automation', automation);
  const line = card?.lines?.find((entry) => entry.label === 'Runs');
  return line?.value ?? 'On a schedule';
}

/** A row is named by its own words, and one saved without a prompt still needs a name. */
function nameOf(automation) {
  const prompt = String(automation?.prompt ?? '').trim();
  return prompt === '' ? 'this automation' : prompt;
}

/** One run's outcome, in the words the row shows beside its time. */
function runStatusLabel(run) {
  return String(run?.status ?? '').toLowerCase() === 'failed' ? 'Failed' : 'Worked';
}

/**
 * What one run has to say: the failure sentence when it failed, otherwise the
 * answer it produced. A run that finished with neither still needs a line, or the
 * row reads as if the page lost it.
 */
function runText(run) {
  const failure = String(run?.error ?? '').trim();
  if (failure !== '') return failure;
  const answer = String(run?.text ?? '').trim();
  return answer === '' ? 'It ran but returned nothing to show.' : answer;
}

export default function AutomationsView() {
  const [automations, setAutomations] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cadenceType, setCadenceType] = useState('daily');
  const [timeOfDay, setTimeOfDay] = useState('07:00');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [runAt, setRunAt] = useState(nextHourInput);
  const [deliverEmail, setDeliverEmail] = useState(false);
  const [adding, setAdding] = useState(false);
  // One id at a time: a second press on a row that is already waiting would send
  // two writes for the same automation and the answers could arrive out of order.
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  // Which row is open, and the history that has been fetched so far. The runs are
  // only asked for when a row is opened, so a page of ten automations is one
  // request rather than eleven, and they are kept so closing and opening a row
  // again costs nothing.
  const [openId, setOpenId] = useState('');
  const [runsById, setRunsById] = useState({});
  const [runsStatus, setRunsStatus] = useState('idle');
  const [runsError, setRunsError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      setAutomations(await listAutomations());
      setStatus('ready');
    } catch (error) {
      // The server names what went wrong, so its sentence is shown rather than a
      // generic one.
      setLoadError(error?.message || 'Your automations could not be loaded.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Running automations first, the one that fires soonest at the top, because the
  // next thing Zuri will do by itself is the one worth seeing. A paused one falls
  // to the bottom as a record. A row with no next run sorts last among its own.
  const ordered = useMemo(
    () => [...automations].sort((a, b) => {
      if (Boolean(a?.enabled) !== Boolean(b?.enabled)) return a?.enabled ? -1 : 1;
      const left = momentTime(a?.nextRunAt) || Number.MAX_SAFE_INTEGER;
      const right = momentTime(b?.nextRunAt) || Number.MAX_SAFE_INTEGER;
      return left - right;
    }),
    [automations],
  );
  const runningCount = ordered.filter((automation) => automation.enabled).length;

  const add = useCallback(
    async (event) => {
      event.preventDefault();
      const text = prompt.trim();
      if (text === '' || adding) return;

      // Each cadence is checked before anything is sent, so a half-filled form is
      // answered here rather than by a server refusal the person cannot act on.
      let cadence = null;
      if (cadenceType === 'daily') {
        if (!/^\d{2}:\d{2}$/.test(timeOfDay)) {
          setActionError('Choose the time of day this should run.');
          return;
        }
        cadence = { type: 'daily', timeOfDay };
      } else if (cadenceType === 'interval') {
        const minutes = Math.round(Number(intervalMinutes));
        if (!Number.isFinite(minutes) || minutes <= 0) {
          setActionError('Say how many minutes apart this should run.');
          return;
        }
        cadence = { type: 'interval', minutes };
      } else {
        // The field is read as local time by the browser; a real Date is built from
        // it first so the moment sent is the one the person picked.
        const when = new Date(runAt);
        if (Number.isNaN(when.getTime())) {
          setActionError('Choose the date and time this should run.');
          return;
        }
        cadence = { type: 'once', at: when.toISOString() };
      }

      setAdding(true);
      setActionError('');
      try {
        const automation = await createAutomation({ prompt: text, cadence, deliverEmail });
        if (automation?.id) {
          setAutomations((rows) => [automation, ...rows]);
        } else {
          await load();
        }
        setPrompt('');
        setCadenceType('daily');
        setTimeOfDay('07:00');
        setIntervalMinutes('60');
        setRunAt(nextHourInput());
        setDeliverEmail(false);
      } catch (error) {
        setActionError(error?.message || 'That automation could not be saved.');
      } finally {
        setAdding(false);
      }
    },
    [adding, cadenceType, deliverEmail, intervalMinutes, load, prompt, runAt, timeOfDay],
  );

  const togglePaused = useCallback(
    async (automation) => {
      if (!automation?.id || busyId !== '') return;
      setBusyId(automation.id);
      setActionError('');
      try {
        const updated = await updateAutomation(automation.id, { enabled: !automation.enabled });
        // The server owns the next run time, so its copy wins when it sends one; a
        // bare answer still flips the row locally.
        setAutomations((rows) => rows.map((row) => (row.id === automation.id
          ? { ...row, ...(updated?.id ? updated : { enabled: !automation.enabled }) }
          : row)));
      } catch (error) {
        setActionError(error?.message || 'That automation could not be changed.');
      } finally {
        setBusyId('');
      }
    },
    [busyId],
  );

  const remove = useCallback(
    async (automation) => {
      if (!automation?.id || busyId !== '') return;
      setBusyId(automation.id);
      setActionError('');
      try {
        await deleteAutomation(automation.id);
        setAutomations((rows) => rows.filter((row) => row.id !== automation.id));
        setConfirmId('');
        if (openId === automation.id) setOpenId('');
      } catch (error) {
        setActionError(error?.message || 'That automation could not be deleted.');
      } finally {
        setBusyId('');
      }
    },
    [busyId, openId],
  );

  const toggleRuns = useCallback(
    async (automation) => {
      if (!automation?.id) return;
      if (openId === automation.id) {
        setOpenId('');
        return;
      }
      setOpenId(automation.id);
      setRunsError('');
      // Already fetched once: shown straight away rather than asked for again.
      if (Array.isArray(runsById[automation.id])) {
        setRunsStatus('ready');
        return;
      }
      setRunsStatus('loading');
      try {
        const runs = await listAutomationRuns(automation.id);
        setRunsById((rows) => ({ ...rows, [automation.id]: runs }));
        setRunsStatus('ready');
      } catch (error) {
        setRunsError(error?.message || 'The recent runs could not be loaded.');
        setRunsStatus('error');
      }
    },
    [openId, runsById],
  );

  return (
    <section className="view automation-view">
      <div className="view-head">
        <div>
          <h1>Automations</h1>
          <p>
            A saved instruction Zuri carries out on its own schedule, even when your computer is off.
            It can search the web while it works, and it tells you what it found.
          </p>
        </div>
      </div>

      {status === 'error' && <InlineAlert tone="danger">{loadError}</InlineAlert>}

      <form className="card project-form" onSubmit={(event) => void add(event)}>
        <p className="project-form-title">Set up an automation</p>

        <div className="project-field">
          <label className="project-field-label" htmlFor="automation-new-prompt">
            What should Zuri do each time
          </label>
          <Textarea
            id="automation-new-prompt"
            className="project-input automation-prompt"
            rows={3}
            maxLength={PROMPT_MAX_LENGTH}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Check for project manager jobs in Scotland and summarise anything new"
          />
        </div>

        <div className="task-form-grid">
          <div className="project-field">
            <label className="project-field-label" htmlFor="automation-new-cadence">
              How often
            </label>
            <Select
              id="automation-new-cadence"
              className="project-input"
              value={cadenceType}
              onChange={(event) => setCadenceType(event.target.value)}
            >
              {CADENCES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>

          {cadenceType === 'daily' && (
            <div className="project-field">
              <span className="project-field-label">
                Time of day
              </span>
              <TimeField
                aria-label="Time of day"
                value={timeOfDay}
                onChange={(event) => setTimeOfDay(event.target.value)}
              />
            </div>
          )}

          {cadenceType === 'interval' && (
            <div className="project-field">
              <span className="project-field-label">
                Minutes apart
              </span>
              <NumberField
                aria-label="Minutes apart"
                min="1"
                max={INTERVAL_MAX_MINUTES}
                step="1"
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.target.value)}
              />
            </div>
          )}

          {cadenceType === 'once' && (
            <div className="project-field">
              <span className="project-field-label">
                Date and time
              </span>
              <DateTimeField
                value={runAt}
                onChange={(event) => setRunAt(event.target.value)}
              />
            </div>
          )}
        </div>

        <Checkbox
          className="admin-check"
          checked={deliverEmail}
          onChange={(event) => setDeliverEmail(event.target.checked)}
        >
          <span>Email me the result</span>
        </Checkbox>

        <p className="project-form-note">
          {cadenceType === 'daily'
            ? 'Runs once a day at the time above.'
            : cadenceType === 'interval'
              ? 'Runs again every interval you set, starting shortly after you save it.'
              : 'Runs once, at the time above.'}
        </p>

        {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}

        <div className="project-form-actions">
          {/* A blank instruction is not an automation, so the button stays off until there is one. */}
          <Button type="submit" isDisabled={adding || prompt.trim() === ''}>
            <PlusIcon size={14} aria-hidden="true" />
            {adding ? 'Saving...' : 'Save automation'}
          </Button>
        </div>
      </form>

      {status === 'loading' && <p className="project-loading">Loading your automations...</p>}

      {status === 'ready' && (
        <article className="card project-section">
          <div className="project-section-head">
            <h2 className="project-section-title">Your automations</h2>
            <span className="project-section-note">
              {ordered.length === 0
                ? 'Nothing yet'
                : `${runningCount} running, ${ordered.length - runningCount} paused`}
            </span>
          </div>

          {ordered.length === 0 ? (
            <div className="reminder-empty">
              <span className="reminder-empty-icon">
                <AutomationIcon size={18} aria-hidden="true" />
              </span>
              <p className="reminder-empty-title">No automations yet</p>
              <p className="reminder-empty-note">
                Ask Zuri in any chat to check something for you every morning, or write the instruction
                in the form above. Zuri then runs it on the server and keeps every answer here.
              </p>
            </div>
          ) : (
            <ul className="reminder-list">
              {ordered.map((automation) => {
                const name = nameOf(automation);
                const next = momentLabel(automation.nextRunAt);
                const last = momentLabel(automation.lastRunAt);
                const failed = String(automation.lastStatus ?? '').toLowerCase() === 'failed';
                const isOpen = openId === automation.id;
                const runs = runsById[automation.id] ?? [];
                return (
                  <li
                    key={automation.id}
                    className={automation.enabled ? 'reminder-row' : 'reminder-row is-done'}
                  >
                    <span className="reminder-row-body">
                      <span className="reminder-row-title">{name}</span>
                      <span className="reminder-row-meta">
                        <span className="reminder-row-date">{cadenceLabel(automation)}</span>
                        {automation.enabled && next !== '' && (
                          <span className="reminder-row-date">Next run {next}</span>
                        )}
                        {!automation.enabled && <span className="reminder-row-done">Paused</span>}
                        {last === ''
                          ? <span className="reminder-row-date">Has not run yet</span>
                          : (
                            <span className="reminder-row-date">
                              Last run {last}
                              {failed ? ', it failed' : ''}
                            </span>
                          )}
                        {automation.deliverEmail && <span className="reminder-row-date">Emailed to you</span>}
                      </span>
                    </span>

                    <span className="reminder-row-actions">
                      <Button
                        variant="ghost"
                        aria-expanded={isOpen}
                        onClick={() => void toggleRuns(automation)}
                      >
                        {isOpen ? 'Hide runs' : 'Recent runs'}
                      </Button>
                      <Button
                        variant="ghost"
                        isDisabled={busyId === automation.id}
                        onClick={() => void togglePaused(automation)}
                      >
                        {automation.enabled ? 'Pause' : 'Resume'}
                      </Button>
                      <IconButton
                        label={`Delete ${name}`}
                        className="row-delete"
                        size="sm"
                        isDisabled={busyId === automation.id}
                        onClick={() => {
                          setConfirmId(automation.id);
                          setActionError('');
                        }}
                      >
                        <DeleteIcon size={14} aria-hidden="true" />
                      </IconButton>
                    </span>

                    {confirmId === automation.id && (
                      // Asked in the row itself rather than in a browser dialog, so the
                      // wording matches the rest of the page and a phone never blocks.
                      <span className="reminder-confirm" role="group" aria-label={`Delete ${name}?`}>
                        <span className="reminder-confirm-note">
                          Delete this automation and its history?
                        </span>
                        <Button
                          variant="ghost"
                          className="task-confirm-delete"
                          isDisabled={busyId === automation.id}
                          onClick={() => void remove(automation)}
                        >
                          Delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmId('')}>
                          Keep
                        </Button>
                      </span>
                    )}

                    {isOpen && (
                      <div className="automation-runs">
                        {runsStatus === 'loading' && <p className="project-loading">Loading the recent runs...</p>}
                        {runsStatus === 'error' && <InlineAlert tone="danger">{runsError}</InlineAlert>}
                        {runsStatus === 'ready' && runs.length === 0 && (
                          <p className="reminder-empty-note">
                            Nothing to show yet. The answers appear here once this has run.
                          </p>
                        )}
                        {runsStatus === 'ready' && runs.map((run) => (
                          <div className="automation-run" key={run.id}>
                            <div className="automation-run-head">
                              <span className="reminder-row-date">{momentLabel(run.startedAt) || 'Time not recorded'}</span>
                              <Chip tone={String(run.status ?? '').toLowerCase() === 'failed' ? 'danger' : 'success'}>
                                {runStatusLabel(run)}
                              </Chip>
                            </div>
                            {/* Plain text, never markup: an answer Zuri fetched off the web
                                must not be able to put HTML into this page. */}
                            <p className="automation-run-text">{runText(run)}</p>
                          </div>
                        ))}
                      </div>
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
