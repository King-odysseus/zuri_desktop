import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Input } from '@heroui/react';

const FILTERS = ['active', 'done', 'all'];

const PRIORITY_COLOR = { low: 'default', medium: 'warning', high: 'danger' };

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

  return (
    <main className="flex h-full flex-1 flex-col bg-background text-foreground">
      <div className="flex justify-center pt-6">
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
      </div>

      <div className="w-full min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <form onSubmit={addTask} className="mb-6 flex gap-2">
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="Add a task"
            aria-label="New task title"
            fullWidth
          />
          <Button type="submit" variant="primary" isDisabled={newTitle.trim() === ''}>
            Add
          </Button>
        </form>

        {status === 'loading' && <p className="text-sm text-muted">Loading tasks...</p>}

        {status === 'error' && (
          <p className="text-sm text-muted">
            Task data is only available when this page runs inside the Zuri app, not the
            browser preview.
          </p>
        )}

        {status === 'ready' && visible.length === 0 && (
          <p className="text-sm text-muted">No {filter === 'all' ? '' : filter} tasks.</p>
        )}

        {status === 'ready' && (
          <ul className="flex flex-col gap-2">
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
                  aria-label={`Delete ${task.title}`}
                  onPress={() => removeTask(task)}
                >
                  &times;
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
