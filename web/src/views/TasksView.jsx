import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, IconButton, InlineAlert, Input, Select } from '../components/ui.jsx';
import { CheckIcon, DeleteIcon, PlusIcon, TaskIcon } from '../components/Icons.jsx';
import { createTask, deleteTask, listTasks, updateTask } from '../lib/api.js';

const TITLE_MAX_LENGTH = 200;

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
];

/** Anything the server sends that is not one of the three is read as normal. */
function readPriority(value) {
  const priority = String(value ?? '').toLowerCase();
  return priority === 'low' || priority === 'high' ? priority : 'normal';
}

/** A row is named by its own words, and one saved without a title still needs a name. */
function nameOf(task) {
  const title = String(task?.title ?? '').trim();
  return title === '' ? 'this task' : title;
}

/**
 * A record without a createdAt sorts last instead of jumping to the top: comparing
 * against NaN would otherwise make the order depend on the sort's internals.
 */
function createdTime(task) {
  const time = new Date(task?.createdAt ?? '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * A task's date is a plain day ('2026-11-02'), not a moment. Parsed as a date
 * string it would be UTC midnight, which shows the day before for anyone west of
 * London, so the three numbers are read as a local date instead.
 */
function dueDay(due) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(due ?? '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dueLabel(due) {
  const date = dueDay(due);
  if (!date) return '';
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** An open task whose day has passed is late; a finished one never is. */
function isLate(task) {
  const date = dueDay(task?.due);
  if (!date || task?.done) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

export default function TasksView() {
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [adding, setAdding] = useState(false);
  // One id at a time: a second press on a row that is already waiting would send
  // two writes for the same task and the answer could arrive out of order.
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      setTasks(await listTasks());
      setStatus('ready');
    } catch (error) {
      // The server names what went wrong (a lapsed subscription, a signed-out tab),
      // so its sentence is shown rather than a generic one.
      setLoadError(error?.message || 'Your tasks could not be loaded.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Open work first: a finished task is a record, not a job. Inside each group the
  // newest sits on top, which is where a task Zuri has just added appears.
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => {
      if (Boolean(a?.done) !== Boolean(b?.done)) return a?.done ? 1 : -1;
      return createdTime(b) - createdTime(a);
    }),
    [tasks],
  );
  const openCount = ordered.filter((task) => !task.done).length;

  const add = useCallback(
    async (event) => {
      event.preventDefault();
      const text = title.trim();
      if (text === '' || adding) return;
      setAdding(true);
      setActionError('');
      try {
        const task = await createTask({ title: text, due, priority });
        if (task?.id) {
          setTasks((rows) => [task, ...rows]);
        } else {
          // A server that answers without the record still saved it, so the list is
          // read again rather than left one task short.
          await load();
        }
        setTitle('');
        setDue('');
        setPriority('normal');
      } catch (error) {
        setActionError(error?.message || 'That task could not be saved.');
      } finally {
        setAdding(false);
      }
    },
    [adding, due, load, priority, title],
  );

  const toggle = useCallback(
    async (task) => {
      if (!task?.id || busyId !== '') return;
      setBusyId(task.id);
      setActionError('');
      try {
        const updated = await updateTask(task.id, { done: !task.done });
        // The server's copy wins when it sends one; a bare answer still flips the
        // row locally so the tick matches what was just asked for.
        setTasks((rows) => rows.map((row) => (row.id === task.id ? { ...row, ...(updated?.id ? updated : { done: !task.done }) } : row)));
      } catch (error) {
        setActionError(error?.message || 'That task could not be changed.');
      } finally {
        setBusyId('');
      }
    },
    [busyId],
  );

  const remove = useCallback(
    async (task) => {
      if (!task?.id || busyId !== '') return;
      setBusyId(task.id);
      setActionError('');
      try {
        await deleteTask(task.id);
        setTasks((rows) => rows.filter((row) => row.id !== task.id));
        setConfirmId('');
      } catch (error) {
        setActionError(error?.message || 'That task could not be deleted.');
      } finally {
        setBusyId('');
      }
    },
    [busyId],
  );

  return (
    <section className="view task-view">
      <div className="view-head">
        <div>
          <h1>Tasks</h1>
          <p>
            Everything Zuri is holding for you. Tick a task off here, or ask for one in any chat and it
            arrives on this list.
          </p>
        </div>
      </div>

      {status === 'error' && <InlineAlert tone="danger">{loadError}</InlineAlert>}

      <form className="card project-form" onSubmit={(event) => void add(event)}>
        <p className="project-form-title">Add a task</p>
        <div className="task-form-grid">
          <div className="project-field">
            <label className="project-field-label" htmlFor="task-new-title">
              What needs doing
            </label>
            <Input
              id="task-new-title"
              className="project-input"
              maxLength={TITLE_MAX_LENGTH}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Send Zuri to Greg"
            />
          </div>
          <div className="project-field">
            <label className="project-field-label" htmlFor="task-new-due">
              Due (optional)
            </label>
            <Input
              id="task-new-due"
              className="project-input"
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </div>
          <div className="project-field">
            <label className="project-field-label" htmlFor="task-new-priority">
              Priority
            </label>
            <Select
              id="task-new-priority"
              className="project-input"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              {PRIORITIES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}

        <div className="project-form-actions">
          {/* A blank title is not a task, so the button stays off until there is one. */}
          <Button type="submit" isDisabled={adding || title.trim() === ''}>
            <PlusIcon size={14} aria-hidden="true" />
            {adding ? 'Adding...' : 'Add task'}
          </Button>
        </div>
      </form>

      {status === 'loading' && <p className="project-loading">Loading your tasks...</p>}

      {status === 'ready' && (
        <article className="card project-section">
          <div className="project-section-head">
            <h2 className="project-section-title">Your list</h2>
            <span className="project-section-note">
              {ordered.length === 0 ? 'Nothing yet' : `${openCount} open, ${ordered.length - openCount} done`}
            </span>
          </div>

          {ordered.length === 0 ? (
            <div className="task-empty">
              <span className="task-empty-icon">
                <TaskIcon size={18} aria-hidden="true" />
              </span>
              <p className="task-empty-title">No tasks yet</p>
              <p className="task-empty-note">
                Ask Zuri for one in any chat, this one included: say what needs doing and it lands here,
                on every device you sign in on. Anything added above appears in the same list.
              </p>
            </div>
          ) : (
            <ul className="task-list">
              {ordered.map((task) => {
                const name = nameOf(task);
                const date = dueLabel(task.due);
                const level = readPriority(task.priority);
                const late = isLate(task);
                const hasMeta = date !== '' || level !== 'normal' || Boolean(task.done);
                return (
                  <li key={task.id} className={task.done ? 'task-row is-done' : 'task-row'}>
                    <IconButton
                      label={task.done ? `Mark ${name} as not done` : `Mark ${name} as done`}
                      size="sm"
                      className="task-tick"
                      aria-pressed={Boolean(task.done)}
                      isDisabled={busyId === task.id}
                      onClick={() => void toggle(task)}
                    >
                      {task.done && <CheckIcon size={14} aria-hidden="true" />}
                    </IconButton>

                    <span className="task-row-body">
                      <span className="task-row-title">{name}</span>
                      {hasMeta && (
                        <span className="task-row-meta">
                          {date !== '' && (
                            <span className={late ? 'task-row-due is-late' : 'task-row-due'}>
                              {late ? `Overdue, ${date}` : `Due ${date}`}
                            </span>
                          )}
                          {level !== 'normal' && (
                            <Chip tone={level === 'high' ? 'warning' : 'default'}>
                              {level === 'high' ? 'High priority' : 'Low priority'}
                            </Chip>
                          )}
                          {task.done && <span className="task-row-done">Done</span>}
                        </span>
                      )}
                    </span>

                    <span className="task-row-actions">
                      <IconButton
                        label={`Delete ${name}`}
                        tone="danger"
                        size="sm"
                        isDisabled={busyId === task.id}
                        onClick={() => {
                          setConfirmId(task.id);
                          setActionError('');
                        }}
                      >
                        <DeleteIcon size={14} aria-hidden="true" />
                      </IconButton>
                    </span>

                    {confirmId === task.id && (
                      // Asked in the row itself rather than in a browser dialog, so the
                      // wording matches the rest of the page and a phone never blocks.
                      <span className="task-confirm" role="group" aria-label={`Delete ${name}?`}>
                        <span className="task-confirm-note">Delete this task?</span>
                        <Button
                          variant="ghost"
                          className="task-confirm-delete"
                          isDisabled={busyId === task.id}
                          onClick={() => void remove(task)}
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
