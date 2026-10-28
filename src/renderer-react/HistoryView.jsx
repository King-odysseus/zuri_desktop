import { useEffect, useState } from 'react';
import { Button } from './ui.jsx';
import { ChatIcon, DeleteIcon, EditIcon } from './Icons.jsx';

function formatDate(value) {
  if (typeof value !== 'string' || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function HistoryView({ onSelectThread }) {
  const [threads, setThreads] = useState([]);
  const [status, setStatus] = useState('loading');
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');

  async function reload() {
    const result = await window.zuri?.chats?.list?.();
    if (result?.ok) {
      setThreads(Array.isArray(result.data) ? result.data : []);
      setStatus('ready');
      return;
    }
    setStatus('error');
  }

  useEffect(() => {
    void reload();
  }, []);

  async function removeThread(thread) {
    const title = thread.title || 'New chat';
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const result = await window.zuri?.chats?.delete?.({ threadId: thread.id });
    if (result?.ok) await reload();
  }

  async function clearHistory() {
    if (!window.confirm('Delete all chat history? This cannot be undone.')) return;
    const result = await window.zuri?.chats?.clear?.();
    if (result?.ok) await reload();
  }

  function beginRename(thread) {
    setRenamingId(thread.id);
    setRenameValue(thread.title || 'New chat');
  }

  async function saveRename(thread) {
    if (renameValue.trim() === '') return;
    const result = await window.zuri?.chats?.rename?.({ threadId: thread.id, title: renameValue });
    if (result?.ok) {
      setRenamingId('');
      setRenameValue('');
      await reload();
    }
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Chat history</h1>
            <p className="mt-2 text-sm text-muted">Continue a previous conversation or remove it permanently.</p>
          </div>
          {status === 'ready' && threads.length > 0 && (
            <Button variant="ghost" className="zuri-danger-quiet" onPress={() => void clearHistory()}>
              Clear all history
            </Button>
          )}
        </header>

        {status === 'loading' && <p className="text-sm text-muted">Loading chat history...</p>}
        {status === 'error' && <p role="alert" className="text-sm text-danger">Chat history could not be loaded.</p>}
        {status === 'ready' && threads.length === 0 && <p className="text-sm text-muted">No conversations yet.</p>}

        {status === 'ready' && threads.length > 0 && (
          <div className="flex flex-col gap-2">
            {threads.map((thread) => (
              <div key={thread.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
                <div className="min-w-0 flex-1">
                  {renamingId === thread.id ? (
                    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void saveRename(thread); }}>
                      <input
                        aria-label="Chat title"
                        autoFocus
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(''); }}
                      />
                      <Button type="submit" size="sm" variant="secondary" isDisabled={renameValue.trim() === ''}>Save</Button>
                    </form>
                  ) : <p className="truncate text-sm font-medium">{thread.title || 'New chat'}</p>}
                  <p className="mt-1 text-xs text-muted">{formatDate(thread.updatedAt) || 'No date available'}</p>
                </div>
                {renamingId !== thread.id && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={`Rename ${thread.title || 'chat'}`}
                    title="Rename chat"
                    onPress={() => beginRename(thread)}
                  >
                    <EditIcon size={16} />
                  </Button>
                )}
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Continue ${thread.title || 'chat'}`}
                  title="Continue chat"
                  onPress={() => onSelectThread(thread.id)}
                >
                  <ChatIcon size={16} />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${thread.title || 'chat'}`}
                  title="Delete chat"
                  onPress={() => void removeThread(thread)}
                >
                  <DeleteIcon size={16} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
