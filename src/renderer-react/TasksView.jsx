import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Input } from './ui.jsx';
import { CloseIcon } from './Icons.jsx';

const FILTERS = ['active', 'done', 'all'];

const PRIORITY_COLOR = { low: 'default', medium: 'warning', high: 'danger' };

const EMPTY_STATE = {
  active: { title: 'No open tasks', hint: 'Add a task above to get started.' },
  done: { title: 'Nothing finished yet', hint: 'Tasks you complete will appear here.' },
  all: { title: 'No tasks yet', hint: 'Add a task above to get started.' },
};

// Real port of the legacy Tasks destination (src/renderer/views/tasks.js): the
// three-way active/done/all filter, and the same window.zuri.tasks CRUD the
// legacy page uses, so a task created here is the same tasks.json row.
export default function TasksView() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('active');
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [newTitle, setNewTitle] = useState('');

  const zuriTasks = typeof window !== 'undefined' ? window.zuri?.tasks : undefined;

  async function reload() {
    if (!zuriTasks) {
      // Running in the Vite browser preview, outside Electron: there is no
      // bridge to read tasks.json from, so say that rather than hang on
      // "loading" forever.
      setStatus('error');
      return;
    }
    setStatus('loading');
    const result = await zuriTasks.list();
    if (result?.ok) {
      setTasks(Array.isArray(result.data) ? result.data : []);
      setStatus('ready');
    } else {
      setStatus('error');
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTask(event) {
    event.preventDefault();
    const title = newTitle.trim();
    if (title === '' || !zuriTasks) return;
    setNewTitle('');
    await zuriTasks.create({ title, priority: 'medium' });
    await reload();
  }

  async function toggleDone(task) {
    if (!zuriTasks) return;
    await zuriTasks.update({ id: task.id, done: !task.done });
    await reload();
  }

  async function removeTask(task) {
    if (!zuriTasks) return;
    await zuriTasks.delete({ id: task.id });
    await reload();
  }

  const visible = tasks.filter((task) => {
    if (filter === 'active') return !task.done;
    if (filter === 'done') return task.done;
    return true;
  });
  const openCount = tasks.filter((task) => !task.done).length;
  const empty = EMPTY_STATE[filter] ?? EMPTY_STATE.all;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header className="mb-6">
          <h1 className="text-3xl font-medium tracking-tight">Tasks</h1>
          <p className="mt-2 text-sm text-muted">Everything you need to get done, in one list.</p>
        </header>

        <section className="rounded-xl border border-border bg-surface p-5">
          <form onSubmit={addTask} className="zuri-task-form flex flex-col gap-2 sm:flex-row">
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Add a task"
              aria-label="New task title"
              fullWidth
            />
            <Button
              type="submit"
              variant="primary"
              className="w-full sm:w-auto"
              isDisabled={newTitle.trim() === ''}
            >
              Add
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Task filter"
              className="inline-flex rounded-full border border-border bg-surface-secondary p-1"
            >
              {FILTERS.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant={filter === name ? 'secondary' : 'ghost'}
                  className="rounded-full px-4 capitalize"
                  aria-pressed={filter === name}
                  onPress={() => setFilter(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
            {status === 'ready' && <span className="text-sm text-muted">{openCount} open</span>}
          </div>

          {status === 'loading' && <p className="mt-4 text-sm text-muted">Loading tasks...</p>}

          {status === 'error' && (
            <p className="mt-4 text-sm text-muted">
              Your tasks only appear in the Zuri app, not in this preview.
            </p>
          )}

          {status === 'ready' && visible.length === 0 && (
            <div className="zuri-empty-state mt-4">
              <strong>{empty.title}</strong>
              <p>{empty.hint}</p>
            </div>
          )}

          {status === 'ready' && visible.length > 0 && (
            <ul className="zuri-task-list mt-4 flex flex-col gap-2">
              {visible.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 rounded-xl border border-border px-4 py-3"
                >
                  <Checkbox isSelected={task.done} onChange={() => toggleDone(task)} />
                  <span className={`flex-1 text-sm ${task.done ? 'text-muted line-through' : ''}`}>
                    {task.title}
                  </span>
                  <Chip size="sm" color={PRIORITY_COLOR[task.priority] ?? 'default'}>
                    {task.priority}
                  </Chip>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    className="zuri-danger-quiet"
                    aria-label={`Delete ${task.title}`}
                    onPress={() => removeTask(task)}
                  >
                    <CloseIcon size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
