import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ComposerTextarea } from './ui.jsx';
// The same catalogue Settings offers, so the chip and the Settings picker can never
// disagree about which supplier id sits behind a Zuri name.
import { ZURI_MODELS, zuriModelFor, zuriModelName } from './zuriModels.js';
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  ImageIcon,
  MicIcon,
  NewChatIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PaperclipIcon,
  PlusIcon,
  SlashCommandIcon,
  StopIcon,
} from './Icons.jsx';
import FormattedMessage from './FormattedMessage.jsx';
import { copyText } from './clipboard.js';
// The app mark that sits above the opening line. Importing it lets the bundler
// fingerprint the file and rewrite the URL relative to the built index.html,
// which is what keeps it loading over file:// in the packaged app.
import zuriMarkUrl from './assets/zuri-logo.png';

const OPENING_QUESTION = "What's on the agenda today?";

/**
 * "Good morning", plus the first name when one was saved in Settings. The hour
 * is read when the chat view mounts, so an app left open overnight greets the
 * new day on the next new chat rather than staying on yesterday's afternoon.
 * @param {string} name Saved display name, or '' when none is set.
 * @param {Date} [now]
 * @returns {string}
 */
/**
 * Drag the quick-ask card by its header.
 *
 * The card is a frameless transparent window, so it has no OS title bar, and Chromium's
 * app-region drag does not move one on Windows. The pointer's travel is sent to main,
 * which moves the window by that much. Pointer capture keeps the moves arriving once the
 * pointer leaves the small card, which is what makes a long drag possible.
 * @param {import('react').PointerEvent<HTMLDivElement>} event
 * @returns {void}
 */
function beginOverlayDrag(event) {
  // The window buttons live in the same strip; a press on one is a click, not a drag.
  if (event.button !== 0 || event.target.closest('.zuri-overlay-window-actions')) return;

  const strip = event.currentTarget;
  let lastX = event.screenX;
  let lastY = event.screenY;

  function move(moveEvent) {
    const dx = moveEvent.screenX - lastX;
    const dy = moveEvent.screenY - lastY;
    if (dx === 0 && dy === 0) return;
    lastX = moveEvent.screenX;
    lastY = moveEvent.screenY;
    void window.zuri?.overlay?.moveBy?.({ dx, dy });
  }

  function stop() {
    strip.removeEventListener('pointermove', move);
    strip.removeEventListener('pointerup', stop);
    strip.removeEventListener('pointercancel', stop);
    strip.removeEventListener('lostpointercapture', stop);
    if (strip.hasPointerCapture?.(event.pointerId)) strip.releasePointerCapture(event.pointerId);
  }

  strip.setPointerCapture?.(event.pointerId);
  strip.addEventListener('pointermove', move);
  strip.addEventListener('pointerup', stop);
  strip.addEventListener('pointercancel', stop);
  strip.addEventListener('lostpointercapture', stop);
}

function greetingHeading(name, now = new Date()) {
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') return part;
  // First name only: "Good evening, Alex" reads like a greeting, the full name reads like a form.
  return `${part}, ${trimmed.split(/\s+/)[0]}`;
}

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

// Under the newest reply: one-press rewrites. Each sends a short follow-up in the
// same thread, so the earlier answer stays on screen to compare against.
const QUICK_ADJUSTMENTS = [
  { label: 'Shorter', text: 'Rewrite the same answer, shorter.', field: 'answerLength', value: 'concise' },
  { label: 'More detail', text: 'Rewrite the same answer with more detail.', field: 'answerLength', value: 'detailed' },
  { label: 'Explain simply', text: 'Rewrite the same answer in simpler words.', field: 'answerDetail', value: 'simple' },
  { label: 'As a table', text: 'Show the same answer as a table.', field: 'answerLayout', value: 'structured' },
];

const STYLE_HINT_STORAGE_KEY = 'zuri.styleHints';
/** Uses of one rewrite before Zuri offers to make it the saved default. */
const STYLE_HINT_THRESHOLD = 2;

function readStyleHints() {
  try {
    const raw = window.localStorage.getItem(STYLE_HINT_STORAGE_KEY);
    const parsed = raw === null ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn('[zuri:chat] answer style hints', error?.message ?? error);
    return {};
  }
}

function writeStyleHints(hints) {
  try {
    window.localStorage.setItem(STYLE_HINT_STORAGE_KEY, JSON.stringify(hints));
  } catch (error) {
    console.warn('[zuri:chat] answer style hints', error?.message ?? error);
  }
}

/** Count one use of a rewrite, so the offer follows a habit and not a stray click. */
function countAdjustment(field, value) {
  const hints = readStyleHints();
  const key = `${field}:${value}`;
  const next = (Number(hints[key]) || 0) + 1;
  writeStyleHints({ ...hints, [key]: next });
  return next;
}

function forgetAdjustment(field, value) {
  const hints = readStyleHints();
  delete hints[`${field}:${value}`];
  writeStyleHints(hints);
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

const FILE_KIND_LABELS = { docx: 'Word document', xlsx: 'Excel spreadsheet', pptx: 'PowerPoint presentation', image: 'Image' };

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

/**
 * The model a chat was last answered with, read from its stored replies.
 *
 * A reply keeps the pair that wrote it, so a reopened chat restores the chip without
 * a second settings field to drift out of step with the transcript. The latest one
 * wins, which makes the chip follow the most recent choice made in that chat.
 * @param {any[]} messages
 * @returns {string} A supplier model id, or '' when no reply carries one.
 */
function modelOfMessages(messages) {
  // A hand-edited chats.json can carry a thread with no messages at all.
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const used = list[index]?.model?.model;
    if (typeof used === 'string' && used !== '') return used;
  }
  return '';
}

/**
 * Where a reply should name the model that wrote it.
 *
 * A caption on every bubble would repeat the same name down a long chat that never
 * changed model, and the chip already names the model in use. The label earns its
 * place where the model changed, so the first reply carries it and so does the first
 * reply after a switch, which reads as the point where the conversation moved.
 * Replies saved before a model was recorded carry none and show no caption.
 * @param {any[]} messages
 * @returns {boolean[]} One entry per message, true where the caption belongs.
 */
function modelLabelPositions(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let previous = '';
  return list.map((message) => {
    if (message?.role === 'user') return false;
    const used = typeof message?.model?.model === 'string' ? message.model.model : '';
    if (used === '') return false;
    const show = used !== previous;
    previous = used;
    return show;
  });
}

export default function ChatPanel({ initialThreadId = '', onChatUpdated, onNavigate, compact = false, onNewChat, sidebarCollapsed = false, onToggleSidebar, openingKind = 'question' }) {
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
  // The rewrite a person has now used often enough to be worth offering as their default.
  const [styleOffer, setStyleOffer] = useState(null);
  const [menuView, setMenuView] = useState('');
  // The picture ladder is fetched when the menu opens rather than on mount, and a
  // preview is kept per saved file so a picture shows without reading it back from
  // disk on every render.
  const [imageModels, setImageModels] = useState([]);
  const [imagePreviews, setImagePreviews] = useState({});
  const [imageBusy, setImageBusy] = useState('');
  const [answerLength, setAnswerLength] = useState('balanced');
  // On by default for current answers, then remembered when the person changes it.
  const [webSearch, setWebSearch] = useState(readWebSearchPreference);
  // The model chip. `pickedModelId` is what the person chose in this chat and wins
  // over the last reply's model; '' means nothing was picked here, which leaves the
  // model chosen in Settings in charge.
  const [pickedModelId, setPickedModelId] = useState('');
  const [settingsModelId, setSettingsModelId] = useState('');
  const [modelMenu, setModelMenu] = useState(false);
  const modelMenuRef = useRef(null);
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
  // The shell alternates this per chat session, so the first screen is a
  // greeting one time and the agenda question the next. It is a prop rather
  // than a value this view picks itself: a mount counter would be read twice
  // under React's development checks and land on the same line every time.
  const [personName, setPersonName] = useState('');
  const openingHeading = openingKind === 'greeting' ? greetingHeading(personName) : OPENING_QUESTION;

  // The greeting greets the person by name only once Settings has answered, so
  // the line is derived from state rather than baked in when the turn was taken.
  useEffect(() => {
    let active = true;
    const loadName = async () => {
      const result = await api?.settings?.get?.();
      if (!active || !result?.ok) return;
      if (typeof result.data?.name === 'string') setPersonName(result.data.name);
      if (typeof result.data?.answerLength === 'string') setAnswerLength(result.data.answerLength);
      if (typeof result.data?.model === 'string') setSettingsModelId(result.data.model);
    };
    void loadName();
    return () => { active = false; };
  }, [api]);

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
      // A reopened chat starts on the model its last reply used.
      setPickedModelId(modelOfMessages(thread.messages));
    };
    void loadThread();
    return () => { active = false; };
  }, [api, initialThreadId]);

  // A brand new chat starts from Settings again rather than inheriting the model of
  // whichever chat happened to be open before it.
  useEffect(() => {
    if (initialThreadId !== '') return;
    setPickedModelId('');
  }, [initialThreadId]);

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

  // The chip's list closes on the same two gestures as the + menu, with its own ref
  // so closing one popover cannot close the other.
  useEffect(() => {
    if (!modelMenu) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && modelMenuRef.current?.contains(event.target)) return;
      setModelMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [modelMenu]);

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
      setError('That message could not be copied to the clipboard.');
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

  /**
   * Load the picture names once per session, when the menu opens on them. Each
   * entry says whether a key is saved behind it, so a name nobody can pay for is
   * shown dimmed instead of failing after the person types a whole prompt.
   * @returns {Promise<void>}
   */
  async function loadImageModels() {
    if (imageModels.length > 0 || typeof api?.images?.models !== 'function') return;
    const listed = await api.images.models();
    if (listed?.ok === true && Array.isArray(listed.data)) setImageModels(listed.data);
  }

  /**
   * Draw a picture with one of Zuri's image names and keep it in the chat.
   *
   * The picture is made before anything is written to the thread, so a failed call
   * leaves the chat as it was with one readable error line, instead of a question
   * in the history that never gets an answer under it.
   * @param {{ code: string, name: string, nairaPerImage: number }} model
   * @returns {Promise<void>}
   */
  async function createImage(model) {
    const prompt = draft.trim();
    setMenuView('');
    if (prompt === '') {
      setError('Describe the picture you want in the message box first.');
      return;
    }
    if (imageBusy !== '' || replying) return;
    if (typeof api?.images?.generate !== 'function' || typeof api?.chats?.create !== 'function') {
      setError('Pictures are only available inside the Zuri app.');
      return;
    }

    setError('');
    setImageBusy(model.name);
    try {
      const made = await api.images.generate({ prompt, modelCode: model.code });
      if (made?.ok !== true) {
        setError(made?.error?.message ?? 'Zuri could not make that picture. Try again.');
        return;
      }

      let activeThreadId = threadId;
      if (activeThreadId === '') {
        const created = await api.chats.create({ title: prompt.slice(0, 60) || 'New chat' });
        if (!created?.ok || typeof created.data?.id !== 'string') {
          setError(created?.error?.message ?? 'A new chat could not be created.');
          return;
        }
        activeThreadId = created.data.id;
        setThreadId(activeThreadId);
      }

      const asked = await api.chats.appendMessage({
        threadId: activeThreadId,
        message: { role: 'user', content: prompt },
      });
      if (!asked?.ok) {
        setError(asked?.error?.message ?? 'Your message could not be saved.');
        return;
      }

      const image = made.data?.image ?? {};
      const naira = Number(made.data?.nairaPerImage ?? model.nairaPerImage ?? 0);
      const saved = await api.chats.appendMessage({
        threadId: activeThreadId,
        message: {
          role: 'assistant',
          content: `${model.name} drew this for about NGN ${naira}. It is saved in your workspace under images.`,
          files: [{ name: image.name, path: image.path, kind: 'image', bytes: image.bytes }],
        },
      });
      if (!saved?.ok) {
        setError(saved?.error?.message ?? 'The picture was made but the chat could not save it.');
        return;
      }

      setMessages(Array.isArray(saved.data?.thread?.messages) ? saved.data.thread.messages : []);
      if (typeof made.data?.previewUrl === 'string' && typeof image.path === 'string') {
        setImagePreviews((current) => ({ ...current, [image.path]: made.data.previewUrl }));
      }
      setDraft('');
      onChatUpdated?.();
    } catch (drawError) {
      setError(drawError?.message ?? 'Zuri could not make that picture.');
    } finally {
      setImageBusy('');
    }
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

  /**
   * Send one turn: create the thread when this is its first message, append the
   * text, ask for the reply, then repaint from the store's saved copy. Send and the
   * quick rewrites both come through here, so the two behave identically.
   * @param {string} content Message text.
   * @param {string} title Title for a thread this turn creates.
   * @param {{ name: string, path: string } | null} [image] Attached image, if any.
   * @param {boolean} [localOnly] True when the turn carries an attachment: its text
   *   then holds the file itself, so it stays on this device and is never uploaded.
   */
  async function runTurn(content, title, image = null, localOnly = false) {
    if (typeof api?.chats?.create !== 'function' || typeof api?.chats?.appendMessage !== 'function' || typeof api?.chat?.send !== 'function') {
      setError('Chat is only available when this page runs inside the Zuri app.');
      setReplying(false);
      return;
    }

    setError('');
    setStreamingText('');
    setStreamingFiles([]);
    setReplying(true);

    try {
      let activeThreadId = threadId;
      if (activeThreadId === '') {
        const created = await api.chats.create({ title: title.slice(0, 60) || 'New chat' });
        if (!created?.ok || typeof created.data?.id !== 'string') {
          setError(created?.error?.message ?? 'A new chat could not be created.');
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
          ...(image ? { images: [image] } : {}),
          ...(localOnly ? { localOnly: true } : {}),
        },
      });
      if (!appended?.ok) {
        setError(appended?.error?.message ?? 'Your message could not be saved.');
        return;
      }
      setMessages(Array.isArray(appended.data?.thread?.messages) ? appended.data.thread.messages : []);
      onChatUpdated?.();

      // The chip's model travels with this one send. A chat with no choice of its own
      // sends nothing, which leaves Settings in charge rather than pinning today's
      // default into every chat opened later.
      const result = await api.chat.send({
        threadId: activeThreadId,
        webSearch,
        ...(chatModel !== null ? { model: { provider: chatModel.provider, model: chatModel.model } } : {}),
      });
      if (!result?.ok) {
        if (result?.error?.code === 'CHAT_STOPPED') {
          // Stop intentionally discards the partial answer, so this is the
          // outcome the person asked for and not an error worth a red line.
          setStreamingText('');
        } else {
          setError(result?.error?.message ?? 'Zuri could not respond. Check Settings and try again.');
        }
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

  async function sendMessage(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if ((prompt === '' && !attachment) || replying) return;

    setDraft('');
    if (listening) recognitionRef.current?.stop();
    // Held from here so a second click during the file read cannot send twice.
    setReplying(true);

    let content = prompt || 'Please analyze the attached file.';
    let image = null;
    const attachedImage = attachment && attachment.kind !== 'folder' && isImageName(attachment.name);
    if (attachedImage) image = { name: attachment.name, path: attachment.path };
    if (attachment?.kind === 'folder') {
      content = `${content}\n\nAttached folder: ${attachment.name} (${attachment.fileCount} files)\n\n${attachment.text}`;
    } else if (attachment && !attachedImage) {
      if (typeof api?.tools?.run !== 'function' || typeof attachment.path !== 'string' || attachment.path === '') {
        setError('This file could not be read. Choose it again or use the Files page.');
        setReplying(false);
        return;
      }
      const read = await api.tools.run({ name: 'readFile', args: { path: attachment.path } });
      const attachmentText = read?.ok && typeof read.data?.text === 'string' ? read.data.text.trim() : '';
      if (attachmentText === '') {
        setError(read?.error?.message ?? 'That file could not be read. Try a text or Office document.');
        setReplying(false);
        return;
      }
      content = `${content}\n\nAttached file: ${attachment.name} (path: ${attachment.path})\n\n${attachmentText}`;
    }

    // Any attachment makes the whole turn device-only, whatever kind it is: the text
    // above now holds the file's own wording, and the answer will quote it back.
    await runTurn(content, prompt || attachment?.name || 'New chat', image, attachment !== null);
  }

  /**
   * Rewrite the last answer in a new shape. The follow-up is an ordinary message,
   * so the thread keeps both versions and the request stays readable in history.
   * @param {{ label: string, text: string, field: string, value: string }} adjustment
   */
  async function adjustAnswer(adjustment) {
    if (replying) return;
    // Two uses of the same rewrite is a habit worth offering as a default. The
    // offer only ever suggests, and "Not now" resets the count so it stops asking.
    if (countAdjustment(adjustment.field, adjustment.value) >= STYLE_HINT_THRESHOLD) {
      setStyleOffer({ field: adjustment.field, value: adjustment.value });
    }
    await runTurn(adjustment.text, adjustment.text);
  }

  /**
   * Remember the model for the rest of this chat.
   *
   * Nothing is written here. The choice rides with the next message and is stored on
   * the reply it produces, so changing the chip can never race a reply already in
   * flight, and a chat keeps its model without a second settings write.
   * @param {{ provider: string, model: string }} entry
   */
  function pickModel(entry) {
    setPickedModelId(entry.model);
    setModelMenu(false);
  }

  async function chooseAnswerLength(value) {
    const saved = await api?.settings?.save?.({ answerLength: value });
    if (saved?.ok !== true) {
      setError(saved?.error?.message ?? 'That preference could not be saved.');
      return;
    }
    setAnswerLength(value);
  }

  async function saveStyleDefault() {
    if (styleOffer === null) return;
    const saved = await api?.settings?.save?.({ [styleOffer.field]: styleOffer.value });
    if (saved?.ok !== true) {
      setError(saved?.error?.message ?? 'That preference could not be saved.');
      return;
    }
    forgetAdjustment(styleOffer.field, styleOffer.value);
    setStyleOffer(null);
  }

  function dismissStyleOffer() {
    if (styleOffer !== null) forgetAdjustment(styleOffer.field, styleOffer.value);
    setStyleOffer(null);
  }

  // Only the newest answer carries the rewrite row: on every answer it would turn
  // the transcript into a wall of buttons.
  const lastAnswerIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== 'user') return index;
    }
    return -1;
  }, [messages]);

  // Which model answers this chat: the one picked here, else the one the last reply
  // used, else the one chosen in Settings, so the chip never shows a model other than
  // the one about to be asked.
  const chatModelId = useMemo(() => {
    if (pickedModelId !== '') return pickedModelId;
    const remembered = modelOfMessages(messages);
    return remembered !== '' ? remembered : settingsModelId;
  }, [pickedModelId, messages, settingsModelId]);
  const chatModel = zuriModelFor(chatModelId);
  const modelLabels = useMemo(() => modelLabelPositions(messages), [messages]);
  const chatModelLabel = zuriModelName(chatModelId) || 'Zuri';

  const hasConversation = messages.length > 0 || streamingText !== '';
  // The window opens maximised, so a 56rem column left most of a wide screen
  // empty. It grows in two steps while a line of text stays readable, and the
  // floating overlay keeps the narrow width because it is a small card.
  const contentWidth = compact ? 'max-w-4xl' : 'max-w-4xl xl:max-w-5xl 2xl:max-w-6xl';

  return (
    <main className={`relative flex h-full min-w-0 flex-1 flex-col bg-background text-foreground ${compact ? 'zuri-overlay-panel' : ''}`}>
      {/* Two bare floating icons rather than one pill: the sidebar toggle keeps
          the top-left corner it had, and starting a new chat moves to the
          top-right where it does not crowd the toggle. Neither carries a
          background, border or shadow of its own, so the conversation stays
          unbroken behind them; the icon colour and a soft drop shadow keep them
          readable once text scrolls underneath. */}
      {!compact && onToggleSidebar && (
        <Button
          isIconOnly
          variant="ghost"
          className="zuri-chat-float zuri-chat-float-left"
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          onPress={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpenIcon size={19} /> : <PanelLeftCloseIcon size={19} />}
        </Button>
      )}
      {!compact && onNewChat && (
        <Button
          isIconOnly
          variant="ghost"
          className="zuri-chat-float zuri-chat-float-right"
          aria-label="New chat"
          title="New chat"
          onPress={onNewChat}
        >
          <NewChatIcon size={19} />
        </Button>
      )}
      {/* The card is a frameless window, so this strip is its title bar: the CSS
          app-region drag moves the whole popup around the screen, and the buttons
          opt out of it so they keep their clicks. It sits outside the scrolling
          content, which leaves the transcript selectable. */}
      {compact && (
        <div className="zuri-overlay-header" onPointerDown={beginOverlayDrag}>
          <span className="zuri-overlay-title">
            <span className="zuri-overlay-grip" aria-hidden="true" />
            Zuri
          </span>
          <div className="zuri-overlay-window-actions">
            <Button isIconOnly size="sm" variant="ghost" aria-label="Open Zuri" title="Open Zuri" onPress={() => void window.zuri?.overlay?.openMain?.()}>
              <ExpandIcon size={16} />
            </Button>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Close" title="Close (Esc)" onPress={() => void window.zuri?.overlay?.hide?.()}>
              <CloseIcon size={16} />
            </Button>
          </div>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 flex-col items-center px-4 sm:px-6 ${compact ? 'zuri-overlay-content justify-end p-3' : hasConversation ? 'justify-end pb-4 pt-4 sm:pb-6 sm:pt-6' : 'justify-center pb-10 sm:pb-24'}`}>
        {!compact && !hasConversation && (
          <div className={`mb-6 flex w-full ${contentWidth} flex-col items-center`}>
            {/* The mark sits above the line rather than beside it: the heading is
                the thing to read, and a logo beside it would pull the eye first. */}
            <img
              src={zuriMarkUrl}
              alt=""
              aria-hidden="true"
              width={52}
              height={52}
              className="zuri-chat-mark"
              decoding="async"
            />
            <h1 className="mt-5 text-center text-3xl font-medium tracking-tight">{openingHeading}</h1>
            <p className="mt-3 text-center text-base text-muted">{capabilityHint}</p>
          </div>
        )}

        {hasConversation && (
          <div ref={scrollRef} onScroll={handleTranscriptScroll} className={`zuri-scrollbar-hidden mb-4 flex w-full ${contentWidth} min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto ${compact ? 'py-4' : 'pb-4 pt-14'}`}>
            {messages.map((message, index) => (
              message.role === 'user' ? (
                <div key={messageKey(message, index)} className="flex min-w-0 max-w-[85%] flex-col items-end gap-1 self-end">
                  <div className="min-w-0 break-words rounded-2xl bg-accent px-4 py-3 text-sm text-accent-foreground">
                    {message.content}
                  </div>
                  {/* People reuse their own wording far more often than they retype
                      it, so a prompt gets the same copy action as a reply. */}
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 rounded-lg text-muted"
                      aria-label="Copy message"
                      title={copiedIndex === index ? 'Copied' : 'Copy message'}
                      onPress={() => void copyMessage(message, index)}
                    >
                      {copiedIndex === index ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={messageKey(message, index)} className="flex min-w-0 max-w-[85%] flex-col items-start gap-1 self-start">
                  {/* The store keeps the model with each reply, so the caption is read back
                      from what was saved rather than from the current chips state. */}
                  {modelLabels[index] && (
                    <span className="px-1 text-xs text-muted">{zuriModelName(message.model.model)}</span>
                  )}
                  <div className="min-w-0 break-words rounded-2xl bg-surface-secondary px-4 py-3 text-sm text-foreground">
                    <FormattedMessage content={message.content} />
                  </div>
                  {Array.isArray(message.files) && message.files.map((file) => (
                    <div key={file.path} className="flex min-w-0 flex-col gap-2">
                      {typeof imagePreviews[file.path] === 'string' && (
                        <img
                          src={imagePreviews[file.path]}
                          alt={file.name}
                          className="max-h-80 w-full rounded-2xl border border-border object-contain"
                          decoding="async"
                        />
                      )}
                      <FileCard file={file} api={api} />
                    </div>
                  ))}
                  {/* Copy and the rewrite choices share one row, so the newest reply
                      keeps one tidy action line instead of two stacked ones. */}
                  <div className="flex flex-wrap items-center gap-1">
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
                    {index === lastAnswerIndex && !replying && QUICK_ADJUSTMENTS.map((adjustment) => (
                      <Button
                        key={adjustment.label}
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-lg px-2 text-xs text-muted"
                        title={`Rewrite: ${adjustment.label}`}
                        aria-label={`Rewrite: ${adjustment.label}`}
                        onPress={() => void adjustAnswer(adjustment)}
                      >{adjustment.label}</Button>
                    ))}
                  </div>
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
            {imageBusy !== '' && <p role="status" className="self-start text-sm text-muted">{imageBusy} is drawing your picture...</p>}
          </div>
        )}

        <div className={`w-full ${contentWidth} ${compact ? 'zuri-overlay-composer-wrap' : ''}`}>
          {error !== '' && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          {styleOffer !== null && (
            <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
              <span className="flex-1">Make that your default for every answer?</span>
              <Button size="sm" variant="primary" onPress={() => void saveStyleDefault()}>Yes, save it</Button>
              <Button size="sm" variant="ghost" onPress={dismissStyleOffer}>Not now</Button>
            </div>
          )}
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
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" title="Draw a picture with one of Zuri's image models" onClick={() => pickMenuItem(() => { void loadImageModels(); setMenuView('image'); })}>
                        <ImageIcon size={16} />
                        <span className="flex-1">Create an image</span>
                      </button>
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => setMenuView('length')}>
                        <SlashCommandIcon size={16} />
                        <span className="flex-1">Reply length</span>
                        <span className="text-xs text-muted capitalize">{answerLength}</span>
                      </button>
                      <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => setMenuView('commands')}>
                        <SlashCommandIcon size={16} />
                        <span>Slash commands</span>
                      </button>
                    </>
                  ) : menuView === 'image' ? (
                    <div className="flex flex-col gap-1">
                      {imageModels.length === 0 && <p className="px-3 py-2 text-xs text-muted">Checking which picture models you can use...</p>}
                      {imageModels.map((model) => (
                        <button
                          key={model.code}
                          type="button"
                          role="menuitem"
                          disabled={!model.available || imageBusy !== ''}
                          title={model.available ? `${model.hint}. About NGN ${model.nairaPerImage} an image.` : 'Add a key for this provider in Settings first.'}
                          className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary disabled:opacity-40"
                          onClick={() => void createImage(model)}
                        >
                          <span className="flex w-full items-center gap-2">
                            <ImageIcon size={15} />
                            {model.name}
                            <span className="ml-auto text-xs text-muted">NGN {model.nairaPerImage}</span>
                          </span>
                          <span className="text-xs text-muted">{model.available ? model.hint : 'Needs a key in Settings'}</span>
                        </button>
                      ))}
                    </div>
                  ) : menuView === 'length' ? (
                    [['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']].map(([value, label]) => (
                      <button key={value} type="button" role="menuitemradio" aria-checked={answerLength === value} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onClick={() => pickMenuItem(() => void chooseAnswerLength(value))}>
                        <span className="flex-1">{label}</span>
                        {answerLength === value && <CheckIcon size={16} />}
                      </button>
                    ))
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
            {/* The model chip sits at the right of the row, directly beside Send, so the
            model that will answer is in reach of the thumb that is about to send. It is
            plain text with a chevron, not a filled pill: the row already holds round
            buttons, and a fourth filled shape competed with them. The quick-ask popup is
            a 420px card that keeps its row to the basics, so the chip stays out of it and
            that window follows the model in Settings. */}
            {!compact && (
            <div ref={modelMenuRef} className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={modelMenu}
                aria-label={`Chat model: ${chatModelLabel}`}
                title={`${chatModelLabel}${chatModel !== null ? `. ${chatModel.note}` : ''} Change the model for this chat.`}
                className="flex h-10 max-w-32 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted outline-none hover:text-foreground focus:ring-2 focus:ring-accent/30"
                onClick={() => setModelMenu((open) => !open)}
              >
                <span className="truncate">{chatModelLabel}</span>
                <ChevronDownIcon size={12} />
              </button>
              {modelMenu && (
                <div role="menu" aria-label="Chat model" className="absolute bottom-full right-0 z-20 mb-2 w-64 rounded-2xl border border-border bg-surface p-1 shadow-lg">
                  <p className="px-3 pb-1 pt-2 text-xs text-muted">Zuri answers this chat with:</p>
                  {ZURI_MODELS.map((entry) => (
                    <button
                      key={entry.model}
                      type="button"
                      role="menuitemradio"
                      aria-checked={entry.name === chatModelLabel}
                      className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary"
                      onClick={() => pickModel(entry)}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="flex-1 truncate">{entry.name}</span>
                        {entry.model === chatModelId && <CheckIcon size={15} />}
                      </span>
                      <span className="text-xs text-muted">{entry.note}</span>
                    </button>
                  ))}
                  <p className="px-3 pb-1 pt-2 text-xs text-muted">Billed to your Zuri plan, like every other reply.</p>
                </div>
              )}
            </div>
            )}
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
              <span className="shrink-0 text-xs text-muted">Stays on this device</span>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
