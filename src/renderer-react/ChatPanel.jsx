import { useEffect, useRef, useState } from 'react';
import { Button, ComposerTextarea } from './ui.jsx';
import { ArrowUpIcon, MicIcon, PlusIcon } from './Icons.jsx';
import FormattedMessage from './FormattedMessage.jsx';
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
const ATTACHMENT_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'md', 'json'];

function messageKey(message, index) {
  return message?.id ?? `${message?.role ?? 'message'}-${index}`;
}

function formatAttachmentSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function appendVoiceText(existing, transcript) {
  const next = transcript.trim();
  if (next === '') return existing;
  const prefix = existing.trimEnd();
  return prefix === '' ? next : `${prefix} ${next}`;
}

function voiceErrorMessage(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone access was blocked. Allow microphone access for Zuri, then try again.';
  }
  if (code === 'no-speech') return 'No speech was detected. Try speaking again.';
  if (code === 'audio-capture') return 'No microphone was found. Connect a microphone, then try again.';
  if (code === 'network') return 'Voice typing could not reach the speech service. Check your connection and try again.';
  return 'Voice typing stopped unexpectedly. Try again.';
}

export default function ChatPanel({ initialThreadId = '', onChatUpdated, onNavigate }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [mode, setMode] = useState('Ask');
  const [workspaceMode, setWorkspaceMode] = useState('chat');
  const [draft, setDraft] = useState('');
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [listening, setListening] = useState(false);
  const composerRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceDraftRef = useRef('');

  useEffect(() => () => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

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

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 192)}px`;
    composer.style.overflowY = composer.scrollHeight > 192 ? 'auto' : 'hidden';
  }, [draft]);

  async function chooseAttachment() {
    if (replying) return;
    if (typeof api?.files?.choose !== 'function') {
      setError('File attachments are only available inside the Zuri app.');
      return;
    }
    const picked = await api.files.choose({ purpose: 'attach' });
    if (!picked?.ok || picked.data?.cancelled) return;
    const name = typeof picked.data?.name === 'string' ? picked.data.name : '';
    const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
    if (!ATTACHMENT_EXTENSIONS.includes(extension)) {
      setError('Attach a PDF, DOCX, XLSX, PPTX, TXT, CSV, Markdown, or JSON file.');
      return;
    }
    setAttachment({
      name,
      path: picked.data?.path,
      size: picked.data?.size,
    });
    setError('');
  }

  function toggleVoiceInput() {
    if (replying) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Recognition = typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;
    if (typeof Recognition !== 'function') {
      setError('Voice typing is not available in this build. You can type your message instead.');
      return;
    }

    const recognition = new Recognition();
    voiceDraftRef.current = draft;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language !== ''
      ? navigator.language
      : 'en-US';
    recognition.onstart = () => {
      setListening(true);
      setError('');
    };
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? '';
      }
      setDraft(appendVoiceText(voiceDraftRef.current, transcript));
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setError(voiceErrorMessage(event.error));
    };
    recognition.onend = () => {
      setListening(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (startError) {
      recognitionRef.current = null;
      setListening(false);
      setError(startError?.message ?? 'Voice typing could not start. Try again.');
    }
  }

  function handleComposerKeyDown(event) {
    // Keep Shift+Enter available for multiline prompts while plain Enter follows
    // the same submit path as the send button. IME composition must not submit
    // before the candidate text has been committed.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    void sendMessage(event);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if ((prompt === '' && !attachment) || replying) return;
    if (typeof api?.chats?.create !== 'function' || typeof api?.chats?.appendMessage !== 'function' || typeof api?.chat?.send !== 'function') {
      setError('Chat is only available when this page runs inside the Zuri app.');
      return;
    }

    setDraft('');
    setError('');
    setStreamingText('');
    setReplying(true);
    if (listening) recognitionRef.current?.stop();

    try {
      let content = prompt || 'Please analyze the attached file.';
      if (attachment) {
        if (typeof api?.tools?.run !== 'function' || typeof attachment.path !== 'string' || attachment.path === '') {
          setError('This file could not be read. Choose it again or use the Files page.');
          return;
        }
        const read = await api.tools.run({ name: 'readFile', args: { path: attachment.path } });
        const attachmentText = read?.ok && typeof read.data?.text === 'string' ? read.data.text.trim() : '';
        if (attachmentText === '') {
          setError(read?.error?.message ?? 'That file could not be read. Try a text or Office document.');
          return;
        }
        content = `${content}\n\nAttached file: ${attachment.name}\n\n${attachmentText}`;
      }
      let activeThreadId = threadId;
      if (activeThreadId === '') {
        const created = await api.chats.create({ title: prompt.slice(0, 60) || attachment?.name || 'New chat' });
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
      setAttachment(null);
    } catch (sendError) {
      setError(sendError?.message ?? 'Zuri could not respond.');
    } finally {
      setReplying(false);
    }
  }

  const hasConversation = messages.length > 0 || streamingText !== '';
  const contentWidth = 'max-w-none';

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

      <div className={`flex min-h-0 flex-1 flex-col items-center px-4 sm:px-6 ${hasConversation ? 'justify-end pb-4 sm:pb-6' : 'justify-center pb-10 sm:pb-24'}`}>
        {!hasConversation && (
          <h1 className="mb-6 text-center text-3xl font-medium tracking-tight">
            {workspaceMode === 'work' ? 'What should we work on?' : "What's on the agenda today?"}
          </h1>
        )}

        {hasConversation && (
          <div className={`zuri-scrollbar-hidden mb-4 flex w-full ${contentWidth} min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto py-4`}>
            {messages.map((message, index) => (
              <div key={messageKey(message, index)} className={`min-w-0 max-w-[85%] break-words rounded-2xl px-4 py-3 text-sm ${message.role === 'user' ? 'self-end bg-accent text-accent-foreground' : 'self-start bg-surface-secondary text-foreground'}`}>
                {message.role === 'user' ? message.content : <FormattedMessage content={message.content} />}
              </div>
            ))}
            {streamingText !== '' && <div className="max-w-[85%] self-start rounded-2xl bg-surface-secondary px-4 py-3 text-sm"><FormattedMessage content={streamingText} /></div>}
            {replying && streamingText === '' && <p className="self-start text-sm text-muted">Zuri is thinking...</p>}
          </div>
        )}

        {workspaceMode === 'work' && !hasConversation && (
          <section className={`mb-6 grid w-full ${contentWidth} grid-cols-1 gap-4 sm:grid-cols-2`} aria-label="Work tools">
            {[
              ['Tasks', 'Plan and track work that needs doing.', 'tasks'],
              ['Files', 'Open, review, and summarise workspace files.', 'files'],
              ['Reminders', 'Keep important follow-ups on schedule.', 'reminders'],
              ['Automations', 'Run recurring research and desktop tasks.', 'automations'],
            ].map(([label, description, route]) => (
              <Button
                key={route}
                variant="ghost"
                className="h-full min-h-24 w-full justify-start rounded-2xl border border-border bg-surface-secondary p-5 text-left"
                onPress={() => onNavigate?.(route)}
              >
                <span className="flex flex-col items-start gap-1">
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="text-sm font-normal text-muted">{description}</span>
                </span>
              </Button>
            ))}
          </section>
        )}

        <div className={`w-full ${contentWidth}`}>
          {error !== '' && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          <form onSubmit={sendMessage} className="flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-sm">
            <Button type="button" isIconOnly size="sm" variant="ghost" aria-label="Attach a file" title="Attach PDF, DOCX, XLSX, PPTX, TXT, CSV, Markdown, or JSON" onPress={() => void chooseAttachment()}>
              <PlusIcon />
            </Button>
            <ComposerTextarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask Zuri"
              aria-label="Message Zuri"
              rows={1}
              className="min-h-10 min-w-0 flex-1 max-h-48 py-2 text-base outline-none"
              disabled={replying}
            />
            <SelectField label="Assistant mode" value={mode} options={MODES} onChange={setMode} hideLabel compact iconOnly className="shrink-0" />
            <Button
              type="button"
              isIconOnly
              size="sm"
              variant={listening ? 'secondary' : 'ghost'}
              aria-label={listening ? 'Stop voice typing' : 'Start voice typing'}
              aria-pressed={listening}
              title={listening ? 'Stop voice typing' : 'Voice to text'}
              onPress={toggleVoiceInput}
              isDisabled={replying}
            >
              <MicIcon />
            </Button>
            <Button type="submit" isIconOnly size="sm" variant="primary" className="h-10 w-10 rounded-full bg-accent p-0 text-accent-foreground shadow-md hover:bg-accent/90 disabled:opacity-40" aria-label="Send" isDisabled={(draft.trim() === '' && !attachment) || replying}>
              <ArrowUpIcon size={18} />
            </Button>
          </form>

          <div className="mt-2 flex min-h-6 items-center justify-between gap-3 px-2 text-xs text-muted">
            {attachment ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-foreground">Attached: {attachment.name}</span>
                {formatAttachmentSize(attachment.size) && <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>}
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onPress={() => setAttachment(null)} isDisabled={replying}>Remove</Button>
              </span>
            ) : (
              <span>Attach PDF, DOCX, XLSX, PPTX, TXT, CSV, Markdown, or JSON files</span>
            )}
          </div>

          {!hasConversation && (
            <div className="mt-4 rounded-2xl border border-border bg-surface-secondary p-3 sm:p-4">
              <p className="px-3 pb-2 pt-1 text-sm text-muted">Try one of these</p>
              <div className="space-y-1">
                {SUGGESTIONS.map((suggestion) => (
                  <Button key={suggestion} variant="ghost" fullWidth className="min-h-10 justify-start rounded-xl px-3 py-2.5 text-left font-normal leading-5" onPress={() => setDraft(suggestion)}>
                  {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
