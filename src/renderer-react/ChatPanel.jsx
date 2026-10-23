import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ComposerTextarea } from './ui.jsx';
import {
  ArrowUpIcon,
  AutomationIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderIcon,
  MicIcon,
  PlusIcon,
  StopIcon,
  TaskIcon,
} from './Icons.jsx';
import FormattedMessage from './FormattedMessage.jsx';
import SelectField from './SelectField.jsx';
import { copyText } from './clipboard.js';

const MODES = ['Ask', 'Act', 'Autopilot'].map((name) => ({ value: name, label: name }));
const WORKSPACE_MODES = [
  { value: 'chat', label: 'Chat' },
  { value: 'work', label: 'Work' },
];
const COMMON_SUGGESTIONS = [
  'Over-budget lines',
  'Add a variance column',
  'Monday inbox brief',
  'Unpaid invoices',
  'Summarise my files',
  'What needs attention',
  'Create a follow-up task',
  'Tomorrow reminder',
  'Draft a reply',
];
const WORK_TOOLS = [
  { route: 'tasks', label: 'Tasks', description: 'Plan and track work that needs doing.', Icon: TaskIcon },
  { route: 'files', label: 'Files', description: 'Open, review, and summarise workspace files.', Icon: FolderIcon },
  { route: 'reminders', label: 'Reminders', description: 'Keep important follow-ups on schedule.', Icon: BellIcon },
  { route: 'automations', label: 'Automations', description: 'Run recurring research and desktop tasks.', Icon: AutomationIcon },
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

export default function ChatPanel({ initialThreadId = '', onChatUpdated, onNavigate, compact = false }) {
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
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [stopping, setStopping] = useState(false);
  const composerRef = useRef(null);
  const scrollRef = useRef(null);
  // Starts true so opening a thread lands on its newest message.
  const stickToBottomRef = useRef(true);
  const recognitionRef = useRef(null);
  const voiceDraftRef = useRef('');
  const suggestions = useMemo(
    () => [...COMMON_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 3),
    [],
  );

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

  // Follow a reply as it streams, but only while the reader is already at the
  // bottom. Scrolling up to reread an earlier answer must not be yanked back.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !stickToBottomRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages, streamingText, replying]);

  function handleTranscriptScroll(event) {
    const scroller = event.currentTarget;
    stickToBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
  }

  async function copyMessage(message, index) {
    const copied = await copyText(String(message?.content ?? ''));
    if (!copied) {
      setError('That reply could not be copied to the clipboard.');
      return;
    }
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex((current) => (current === index ? -1 : current)), 1500);
  }

  async function stopReply() {
    if (stopping || threadId === '' || typeof api?.chat?.stop !== 'function') return;
    setStopping(true);
    try {
      const result = await api.chat.stop({ threadId });
      if (!result?.ok) setError(result?.error?.message ?? 'That reply could not be stopped.');
    } catch {
      setError('That reply could not be stopped.');
    } finally {
      setStopping(false);
    }
  }

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
        if (result?.error?.code === 'CHAT_STOPPED') {
          // Stop intentionally discards the partial answer, so this is the
          // outcome the person asked for and not an error worth a red line.
          setStreamingText('');
        } else {
          setError(result?.error?.message ?? 'Zuri could not respond. Check Settings and try again.');
        }
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
      setStopping(false);
    }
  }

  const hasConversation = messages.length > 0 || streamingText !== '';
  const contentWidth = 'max-w-4xl';
  const workspaceSwitch = (
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
  );

  return (
    <main className={`relative flex h-full min-w-0 flex-1 flex-col bg-background text-foreground ${compact ? 'zuri-overlay-panel' : ''}`}>
      <div className={`flex min-h-0 flex-1 flex-col items-center px-4 sm:px-6 ${compact ? 'zuri-overlay-content justify-end p-3' : hasConversation ? 'justify-end pb-4 pt-4 sm:pb-6 sm:pt-6' : 'justify-center pb-10 sm:pb-24'}`}>
        {!compact && hasConversation && <div className="pb-3">{workspaceSwitch}</div>}

        {!compact && !hasConversation && (
          <div className={`mb-6 flex w-full ${contentWidth} flex-col items-center`}>
            {workspaceSwitch}
            <h1 className="mt-6 text-center text-3xl font-medium tracking-tight">
              {workspaceMode === 'work' ? 'What should we work on?' : "What's on the agenda today?"}
            </h1>
          </div>
        )}

        {hasConversation && (
          <div ref={scrollRef} onScroll={handleTranscriptScroll} className={`zuri-scrollbar-hidden mb-4 flex w-full ${contentWidth} min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto py-4`}>
            {messages.map((message, index) => (
              message.role === 'user' ? (
                <div key={messageKey(message, index)} className="min-w-0 max-w-[85%] self-end break-words rounded-2xl bg-accent px-4 py-3 text-sm text-accent-foreground">
                  {message.content}
                </div>
              ) : (
                <div key={messageKey(message, index)} className="flex min-w-0 max-w-[85%] flex-col items-start gap-1 self-start">
                  <div className="min-w-0 break-words rounded-2xl bg-surface-secondary px-4 py-3 text-sm text-foreground">
                    <FormattedMessage content={message.content} />
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-lg text-muted"
                    aria-label="Copy reply"
                    title={copiedIndex === index ? 'Copied' : 'Copy reply'}
                    onPress={() => void copyMessage(message, index)}
                  >
                    {copiedIndex === index ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  </Button>
                </div>
              )
            ))}
            {streamingText !== '' && <div className="max-w-[85%] self-start rounded-2xl bg-surface-secondary px-4 py-3 text-sm"><FormattedMessage content={streamingText} /></div>}
            {replying && streamingText === '' && <p className="self-start text-sm text-muted">Zuri is thinking...</p>}
          </div>
        )}

        {/* Two columns only once the shell sidebar has left room for them. At
            sm each card is about 200px and the description wraps one word per
            line, so single column holds until lg. */}
        {!compact && !hasConversation && (
          <section className={`mb-6 grid w-full ${contentWidth} grid-cols-1 gap-3 lg:grid-cols-2`} aria-label="Work tools">
            {WORK_TOOLS.map(({ route, label, description, Icon }) => (
              <Button key={route} className="zuri-tool-card text-left" onPress={() => onNavigate?.(route)}>
                <span className="zuri-tool-icon">
                  <Icon size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="text-sm font-medium leading-tight text-foreground">{label}</span>
                  <span className="w-full truncate text-xs font-normal text-muted">{description}</span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 self-center text-muted" />
              </Button>
            ))}
          </section>
        )}

        <div className={`w-full ${contentWidth} ${compact ? 'zuri-overlay-composer-wrap' : ''}`}>
          {error !== '' && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          <form onSubmit={sendMessage} className={`flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-sm ${compact ? 'zuri-overlay-composer' : ''}`}>
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
            />
            <SelectField label="Assistant mode" value={mode} options={MODES} onChange={setMode} hideLabel compact plainTrigger className="shrink-0" />
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
            {replying ? (
              <Button
                type="button"
                isIconOnly
                size="sm"
                variant="secondary"
                className="h-10 w-10 rounded-full p-0"
                aria-label="Stop reply"
                title="Stop reply"
                onPress={() => void stopReply()}
                isDisabled={stopping}
              >
                <StopIcon size={15} />
              </Button>
            ) : (
              <Button type="submit" isIconOnly size="sm" variant="primary" className="h-10 w-10 rounded-full bg-accent p-0 text-accent-foreground shadow-md hover:bg-accent/90 disabled:opacity-40" aria-label="Send" isDisabled={draft.trim() === '' && !attachment}>
                <ArrowUpIcon size={18} />
              </Button>
            )}
          </form>

          {!compact && attachment && (
            <div className="mt-2 flex min-h-6 items-center gap-3 px-2 text-xs text-muted">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-foreground">Attached: {attachment.name}</span>
                {formatAttachmentSize(attachment.size) && <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>}
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onPress={() => setAttachment(null)} isDisabled={replying}>Remove</Button>
              </span>
            </div>
          )}

          {!compact && !hasConversation && (
            <div className="mt-4 px-1 sm:px-2">
              <p className="pb-2 pt-1 text-sm text-muted">Try one of these</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <Button key={suggestion} size="sm" variant="ghost" className="zuri-suggestion-chip font-normal" onPress={() => setDraft(suggestion)}>
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
