import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ComposerTextarea } from './ui.jsx';
import {
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SlashCommandIcon,
  StopIcon,
} from './Icons.jsx';
import FormattedMessage from './FormattedMessage.jsx';
import { copyText } from './clipboard.js';

const CAPABILITY_HINTS = [
  'Ask me to summarise your files.',
  'I can turn a rough thought into a task.',
  'Ask me to remind you about something tomorrow.',
  'I can draft a reply for you to edit.',
  'Ask what needs your attention this week.',
  'I can set up a recurring research automation.',
  'Ask me to explain a document in plain words.',
  'I can search past conversations for you.',
  'Ask me to compare two options and pick one.',
  'Paste a table and I will help you check it.',
];
// Each command only fills the composer with a starter sentence; the person finishes
// it and sends as usual, so nothing runs until they press Send.
const SLASH_COMMANDS = [
  { label: 'Summarise', text: 'Summarise this: ' },
  { label: 'Search the web', text: 'Search the web for ' },
  { label: 'Make a task', text: 'Turn this into a task: ' },
  { label: 'Set a reminder', text: 'Remind me to ' },
  { label: 'Draft a reply', text: 'Draft a reply to this: ' },
];
const IMAGE_EXTENSIONS =['png', 'jpg', 'jpeg', 'webp', 'gif'];
const ATTACHMENT_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'md', 'json', ...IMAGE_EXTENSIONS];

const WEB_SEARCH_STORAGE_KEY = 'zuri.webSearch';

function readWebSearchPreference() {
  try {
    // New installs start ready for current answers; an explicit saved "off" choice
    // still wins so changing the default does not override the person's setting.
    return window.localStorage.getItem(WEB_SEARCH_STORAGE_KEY) !== 'off';
  } catch (error) {
    console.warn('[zuri:chat] web search preference', error?.message ?? error);
    return true;
  }
}

function saveWebSearchPreference(enabled) {
  try {
    window.localStorage.setItem(WEB_SEARCH_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch (error) {
    console.warn('[zuri:chat] web search preference', error?.message ?? error);
  }
}

function isImageName(name) {
  const extension = typeof name === 'string' && name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return IMAGE_EXTENSIONS.includes(extension);
}

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

const FILE_KIND_LABELS = { docx: 'Word document', xlsx: 'Excel spreadsheet', pptx: 'PowerPoint presentation' };

/** A file Zuri built in a reply: open it, find it in its folder, or save a copy elsewhere. */
function FileCard({ file, api }) {
  const [note, setNote] = useState('');
  const run = async (action) => {
    if (typeof api?.files?.[action] !== 'function') return;
    const result = await api.files[action]({ path: file.path });
    if (!result?.ok) setNote(result?.error?.message ?? 'That did not work.');
    else setNote(action === 'saveAs' && result.data?.cancelled === false ? 'Saved' : '');
  };
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-border bg-surface px-3 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <FileIcon size={22} className="shrink-0 text-muted" />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{file.name}</p>
          <p className="text-xs text-muted">{FILE_KIND_LABELS[file.kind] ?? 'File'}{file.bytes ? `, ${formatAttachmentSize(file.bytes)}` : ''}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onPress={() => void run('open')}>Open</Button>
        <Button size="sm" variant="ghost" onPress={() => void run('saveAs')}><DownloadIcon size={14} />Save as</Button>
        <Button size="sm" variant="ghost" onPress={() => void run('reveal')}><FolderIcon size={14} />Show in folder</Button>
      </div>
      {note !== '' && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}

export default function ChatPanel({ initialThreadId = '', onChatUpdated, onNavigate, compact = false }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [draft, setDraft] = useState('');
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingFiles, setStreamingFiles] = useState([]);
  const [replying, setReplying] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [listening, setListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [stopping, setStopping] = useState(false);
  const [menuView, setMenuView] = useState('');
  // On by default for current answers, then remembered when the person changes it.
  const [webSearch, setWebSearch] = useState(readWebSearchPreference);
  const menuRef = useRef(null);
  const composerRef = useRef(null);
  const scrollRef = useRef(null);
  // Starts true so opening a thread lands on its newest message.
  const stickToBottomRef = useRef(true);
  const recognitionRef = useRef(null);
  const voiceDraftRef = useRef('');
  const capabilityHint = useMemo(
    () => CAPABILITY_HINTS[Math.floor(Math.random() * CAPABILITY_HINTS.length)],
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
      if (typeof event.status === 'string') setActivity(event.status);
      if (Array.isArray(event.files)) setStreamingFiles((current) => [...current, ...event.files]);
      if (event.done === true) {
        setReplying(false);
        setActivity('');
      }
    });
  }, [api, threadId]);

  useEffect(() => {
    if (menuView === '') return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && menuRef.current?.contains(event.target)) return;
      setMenuView('');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuView]);

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
      setError('Attach a PDF, DOCX, XLSX, PPTX, TXT, CSV, Markdown, JSON or image file.');
      return;
    }
    setAttachment({
      name,
      path: picked.data?.path,
      size: picked.data?.size,
    });
    setError('');
  }

  async function chooseFolder() {
    if (replying) return;
    if (typeof api?.files?.choose !== 'function') {
      setError('Folders can only be added inside the Zuri app.');
      return;
    }
    const picked = await api.files.choose({ purpose: 'folder' });
    if (!picked?.ok) {
      setError(picked?.error?.message ?? 'That folder could not be read.');
      return;
    }
    if (picked.data?.cancelled) return;
    if (!picked.data?.fileCount) {
      setError('That folder has no text files Zuri can read (txt, md, csv, json, log).');
      return;
    }
    setAttachment({
      kind: 'folder',
      name: picked.data.name,
      text: picked.data.text,
      fileCount: picked.data.fileCount,
      skipped: picked.data.skipped,
    });
    setError('');
  }

  function pickMenuItem(action) {
    setMenuView('');
    action();
  }

  function insertCommand(text) {
    setDraft((current) => (current.trim() === '' ? text : `${current.trimEnd()}\n${text}`));
    composerRef.current?.focus();
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
    setStreamingFiles([]);
    setReplying(true);
    if (listening) recognitionRef.current?.stop();

    try {
      let content = prompt || 'Please analyze the attached file.';
      const attachedImage = attachment && attachment.kind !== 'folder' && isImageName(attachment.name);
      if (attachment?.kind === 'folder') {
        content = `${content}\n\nAttached folder: ${attachment.name} (${attachment.fileCount} files)\n\n${attachment.text}`;
      } else if (attachment && !attachedImage) {
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
        content = `${content}\n\nAttached file: ${attachment.name} (path: ${attachment.path})\n\n${attachmentText}`;
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
        message: {
          role: 'user',
          content,
          ...(attachedImage ? { images: [{ name: attachment.name, path: attachment.path }] } : {}),
        },
      });
      if (!appended?.ok) {
        setError(appended?.error?.message ?? 'Your message could not be saved.');
        setReplying(false);
        return;
      }
      setMessages(Array.isArray(appended.data?.thread?.messages) ? appended.data.thread.messages : []);
      onChatUpdated?.();

      const result = await api.chat.send({ threadId: activeThreadId, webSearch });
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
      setStreamingFiles([]);
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

  return (
    <main className={`relative flex h-full min-w-0 flex-1 flex-col bg-background text-foreground ${compact ? 'zuri-overlay-panel' : ''}`}>
      <div className={`flex min-h-0 flex-1 flex-col items-center px-4 sm:px-6 ${compact ? 'zuri-overlay-content justify-end p-3' : hasConversation ? 'justify-end pb-4 pt-4 sm:pb-6 sm:pt-6' : 'justify-center pb-10 sm:pb-24'}`}>
        {compact && (
          <div className="absolute right-3 top-3 z-10 flex gap-1">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Open Zuri" title="Open Zuri" onPress={() => void window.zuri?.overlay?.openMain?.()}>
              <ExpandIcon size={16} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Close" title="Close (Esc)" onPress={() => void window.zuri?.overlay?.hide?.()}>
              <CloseIcon size={16} />
            </Button>
          </div>
        )}
        {!compact && !hasConversation && (
          <div className={`mb-6 flex w-full ${contentWidth} flex-col items-center`}>
            <h1 className="text-center text-3xl font-medium tracking-tight">What's on the agenda today?</h1>
            <p className="mt-3 text-center text-base text-muted">{capabilityHint}</p>
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
                  {Array.isArray(message.files) && message.files.map((file) => <FileCard key={file.path} file={file} api={api} />)}
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
            {streamingFiles.length > 0 && (
              <div className="flex max-w-[85%] flex-col gap-2 self-start">
                {streamingFiles.map((file) => <FileCard key={file.path} file={file} api={api} />)}
              </div>
            )}
            {replying && activity !== '' && <p className="self-start text-sm text-muted">{activity}...</p>}
            {replying && streamingText === '' && activity === '' && <p className="self-start text-sm text-muted">Zuri is thinking...</p>}
          </div>
        )}

        <div className={`w-full ${contentWidth} ${compact ? 'zuri-overlay-composer-wrap' : ''}`}>
          {error !== '' && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          <form onSubmit={sendMessage} className={`flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-sm ${compact ? 'zuri-overlay-composer' : ''}`}>
            <div ref={menuRef} className="relative">
              <Button type="button" isIconOnly size="sm" variant="ghost" aria-label="Add to message" aria-haspopup="menu" aria-expanded={menuView !== ''} title="Add files, photos or a command" onPress={() => setMenuView((current) => (current === '' ? 'main' : ''))}>
                <PlusIcon />
              </Button>
              {menuView !== '' && (
                <div role="menu" aria-label="Add to message" className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl border border-border bg-surface p-1 shadow-lg">
                  {menuView === 'main' ? (
                    <>
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => pickMenuItem(() => void chooseAttachment())}>
                        <PaperclipIcon size={16} />
                        <span>Add files or photos</span>
                      </button>
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => pickMenuItem(() => void chooseFolder())}>
                        <FolderIcon size={16} />
                        <span>Add folder</span>
                      </button>
                      <button type="button" role="menuitemcheckbox" aria-checked={webSearch} title="Lets Zuri search the web and read pages. Each lookup is an extra request to your provider." className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => { const next = !webSearch; setWebSearch(next); saveWebSearchPreference(next); }}>
                        <GlobeIcon size={16} />
                        <span className="flex-1">Search the web</span>
                        {webSearch && <CheckIcon size={16} />}
                      </button>
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => setMenuView('commands')}>
                        <SlashCommandIcon size={16} />
                        <span>Slash commands</span>
                      </button>
                    </>
                  ) : (
                    SLASH_COMMANDS.map((command) => (
                      <button key={command.label} type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => pickMenuItem(() => insertCommand(command.text))}>
                        <SlashCommandIcon size={16} />
                        <span>{command.label}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
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
                <span className="truncate text-foreground">{attachment.kind === 'folder' ? `Folder: ${attachment.name}` : `Attached: ${attachment.name}`}</span>
                {attachment.kind === 'folder'
                  ? <span className="shrink-0">{attachment.fileCount} files{attachment.skipped > 0 ? `, ${attachment.skipped} skipped` : ''}</span>
                  : formatAttachmentSize(attachment.size) && <span className="shrink-0">{formatAttachmentSize(attachment.size)}</span>}
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onPress={() => setAttachment(null)} isDisabled={replying}>Remove</Button>
              </span>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
