import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpIcon, MicIcon, PlusIcon } from './Icons.jsx';
import SelectField from './SelectField.jsx';

const MODES = ['Ask', 'Act', 'Autopilot'].map((name) => ({ value: name, label: name }));
const WORKSPACE_MODES = [
  { value: 'chat', label: 'Chat' },
  { value: 'work', label: 'Work' },
];
const SUGGESTIONS = [
  'Which lines are over budget?',
  'Add a variance column to Budget.xlsx',
  'Schedule a Monday inbox brief',
  "Find last month's unpaid invoices",
];

function messageKey(message, index) {
  return message?.id ?? `${message?.role ?? 'message'}-${index}`;
}

export default function ChatPanel({ initialThreadId = '', onChatUpdated }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [mode, setMode] = useState('Ask');
  const [workspaceMode, setWorkspaceMode] = useState('chat');
  const [draft, setDraft] = useState('');
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialThreadId === '' || typeof api?.chats?.list !== 'function') return undefined;
    let active = true;
    const loadThread = async () => {
      const result = await api.chats.list();
      const thread = result?.ok ? result.data?.find((entry) => entry?.id === initialThreadId) : null;
      if (!active || !thread) return;
      setMessages(Array.isArray(thread.messages) ? thread.messages : []);
    };
    void loadThread();
    return () => { active = false; };
  }, [api, initialThreadId]);

  useEffect(() => {
    if (typeof api?.chat?.onStream !== 'function') return undefined;
    return api.chat.onStream((event) => {
      if (!event || event.threadId !== threadId) return;
      if (typeof event.delta === 'string') setStreamingText((current) => current + event.delta);
      if (event.done === true) setReplying(false);
    });
  }, [api, threadId]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (content === '' || replying) return;
    if (typeof api?.chats?.create !== 'function' || typeof api?.chats?.appendMessage !== 'function' || typeof api?.chat?.send !== 'function') {
      setError('Chat is only available when this page runs inside the Zuri app.');
      return;
    }

    setDraft('');
    setError('');
    setStreamingText('');
    setReplying(true);

    try {
      let activeThreadId = threadId;
      if (activeThreadId === '') {
        const created = await api.chats.create({ title: content.slice(0, 60) });
        if (!created?.ok || typeof created.data?.id !== 'string') {
          setError(created?.error?.message ?? 'A new chat could not be created.');
          setReplying(false);
          return;
        }
        activeThreadId = created.data.id;
        setThreadId(activeThreadId);
        onChatUpdated?.();
      }

      const appended = await api.chats.appendMessage({
        threadId: activeThreadId,
        message: { role: 'user', content, mode: mode.toLowerCase() },
      });
      if (!appended?.ok) {
        setError(appended?.error?.message ?? 'Your message could not be saved.');
        setReplying(false);
        return;
      }
      setMessages(Array.isArray(appended.data?.thread?.messages) ? appended.data.thread.messages : []);
      onChatUpdated?.();

      const result = await api.chat.send({ threadId: activeThreadId });
      if (!result?.ok) {
        setError(result?.error?.message ?? 'Zuri could not respond. Check Settings and try again.');
        setReplying(false);
        return;
      }
      setMessages(Array.isArray(result.data?.thread?.messages) ? result.data.thread.messages : []);
      onChatUpdated?.();
      setStreamingText('');
    } catch (sendError) {
      setError(sendError?.message ?? 'Zuri could not respond.');
    } finally {
      setReplying(false);
    }
  }

  const hasConversation = messages.length > 0 || streamingText !== '';

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
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

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-10 sm:px-6 sm:pb-24">
        {!hasConversation && (
          <h1 className="mb-6 text-center text-3xl font-medium tracking-tight">
            {workspaceMode === 'work' ? 'What should we work on?' : 'What&rsquo;s on the agenda today?'}
          </h1>
        )}

        {hasConversation && (
          <div className="mb-4 flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-4">
            {messages.map((message, index) => (
              <div key={messageKey(message, index)} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${message.role === 'user' ? 'self-end bg-accent text-accent-foreground' : 'self-start bg-surface-secondary text-foreground'}`}>
                {message.content}
              </div>
            ))}
            {streamingText !== '' && <div className="max-w-[85%] self-start rounded-2xl bg-surface-secondary px-4 py-3 text-sm">{streamingText}</div>}
            {replying && streamingText === '' && <p className="self-start text-sm text-muted">Zuri is thinking...</p>}
          </div>
        )}

        <div className="w-full max-w-3xl">
          {error !== '' && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          <form onSubmit={sendMessage} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 shadow-sm">
            <Button type="button" isIconOnly size="sm" variant="ghost" aria-label="Attach a file">
              <PlusIcon />
            </Button>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={workspaceMode === 'work' ? 'Work with Zuri' : 'Ask Zuri'}
              aria-label="Message Zuri"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
              disabled={replying}
            />
            <SelectField label="Assistant mode" value={mode} options={MODES} onChange={setMode} hideLabel className="min-w-0 w-28 shrink-0" />
            <Button type="button" isIconOnly size="sm" variant="ghost" aria-label="Dictate">
              <MicIcon />
            </Button>
            <Button type="submit" isIconOnly size="sm" variant="primary" className="rounded-full" aria-label="Send" isDisabled={draft.trim() === '' || replying}>
              <ArrowUpIcon />
            </Button>
          </form>

          {!hasConversation && (
            <div className="mt-3 rounded-2xl border border-border bg-surface-secondary p-2">
              <p className="px-3 pb-1 pt-2 text-sm text-muted">Try one of these</p>
              {SUGGESTIONS.map((suggestion) => (
                <Button key={suggestion} variant="ghost" fullWidth className="justify-start font-normal" onPress={() => setDraft(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
