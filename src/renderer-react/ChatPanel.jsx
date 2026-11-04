import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, ComposerTextarea } from './ui.jsx';
// The same catalogue Settings offers, so the chip and the Settings picker can never
// disagree about which supplier id sits behind a Zuri name.
import { ZURI_MODELS, zuriModelFor, zuriModelName } from './zuriModels.js';
// The rewrite row under the newest reply. Shared with the web chat, so the two
// surfaces cannot offer different choices.
import { QUICK_ADJUSTMENTS } from './answerAdjustments.js';
// The card for something Zuri has just created, described once for both this app and the
// web chat, so the two surfaces cannot word the same event differently.
import { describeNotable } from '../shared/notableActions.js';
// Reading a reply aloud with the device's own voice, shared with the web chat.
import { speak, speechAvailable, stopSpeaking } from '../shared/speech.js';
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  EnhanceIcon,
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
  PreviewIcon,
  RegenerateIcon,
  SlashCommandIcon,
  SpeakIcon,
  StopIcon,
} from './Icons.jsx';
import FormattedMessage from './FormattedMessage.jsx';
import { ApprovalCard, ModeMenu, readChatMode, saveChatMode } from './ActControls.jsx';
import ResultPanel from './ResultPanel.jsx';
import { copyText } from './clipboard.js';
import zuriMarkUrl from './assets/zuri-logo.png';
import { PENDING_IMAGE_PROMPT_KEY } from './ImageLibraryView.jsx';
// The app mark that sits above the opening line. Importing it lets the bundler
// fingerprint the file and rewrite the URL relative to the built index.html,
// which is what keeps it loading over file:// in the packaged app.

const OPENING_HEADING = 'What can I help with?';

// Each chip only fills the composer with a starter sentence, like the slash commands;
// nothing is sent until the person presses Send.
const OPENING_IDEAS = [
  { label: 'Summarise a document', text: 'Summarise this: ' },
  { label: 'Draft an email', text: 'Draft an email to ' },
  { label: 'Search the web', text: 'Search the web for ' },
  { label: 'Set a reminder', text: 'Remind me to ' },
];

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
// Picture choices are remembered on this computer: the shape asked for, and whether
// Zuri may rewrite the description for the picture maker (on unless switched off).
const IMAGE_SHAPE_STORAGE_KEY = 'zuri.imageShape';
const IMAGE_IMPROVE_STORAGE_KEY = 'zuri.improveImagePrompt';
const IMAGE_SHAPES = [['square', 'Square'], ['portrait', 'Portrait'], ['landscape', 'Landscape']];

function readLocal(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch (error) {
    console.warn('[zuri:chat] stored choice', error?.message ?? error);
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn('[zuri:chat] stored choice', error?.message ?? error);
  }
}

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

// A pasted picture is typed far more reliably than it is named, so the extension
// main needs to store it comes from the MIME type first, the name second.
const PASTE_EXTENSION_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * The first picture a paste carries, or null when the clipboard holds no image.
 *
 * One clipboard can offer several items, and a copied screenshot often arrives
 * beside text, so every item is checked rather than trusting the first.
 * @param {DataTransfer | null} clipboard
 * @returns {File | null}
 */
function pastedImageFile(clipboard) {
  const items = clipboard?.items;
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item?.kind !== 'file' || !String(item.type ?? '').startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
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

/** A file Zuri built in a reply: preview it beside the chat, open it, find it, or save a copy. */
function FileCard({ file, api, onPreview }) {
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
        {onPreview && file.kind !== 'image' && (
          <Button size="sm" variant="secondary" onPress={() => onPreview(file)}><PreviewIcon size={14} />Preview</Button>
        )}
        <Button size="sm" variant="secondary" onPress={() => void run('open')}>Open</Button>
        <Button size="sm" variant="ghost" onPress={() => void run('saveAs')}><DownloadIcon size={14} />Save as</Button>
        <Button size="sm" variant="ghost" onPress={() => void run('reveal')}><FolderIcon size={14} />Show in folder</Button>
      </div>
      {note !== '' && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}

// The three sections a created something can send you back to. A card naming anything
// else must not become a button that navigates nowhere.
const NOTABLE_VIEWS = ['tasks', 'reminders', 'automations'];

/**
 * The created-something card an event carries, or null when there is nothing to draw.
 *
 * The main process sends the finished card. notableActions.js is the one description of
 * its wording, so a main process that forwards only the kind and the record still gets
 * the same card, while a frame with no title is dropped rather than drawn empty.
 * @param {any} event One frame from the chat stream.
 * @returns {{ id: string, badge: string, title: string, lines: Array<{ label: string, value: string }>, action: string } | null}
 */
function notableFrom(event) {
  const raw = event?.notable;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const card = typeof raw.title === 'string' && raw.title.trim() !== ''
    ? raw
    : describeNotable(raw.kind, raw.data);
  if (card === null || typeof card !== 'object' || typeof card.title !== 'string' || card.title.trim() === '') return null;

  return {
    id: typeof card.id === 'string' ? card.id : '',
    badge: typeof card.badge === 'string' ? card.badge.trim() : '',
    title: card.title.trim(),
    // A line with no value would print its label against nothing.
    lines: Array.isArray(card.lines)
      ? card.lines.filter((line) => line && typeof line.label === 'string' && typeof line.value === 'string' && line.value.trim() !== '')
      : [],
    action: typeof card.action === 'string' ? card.action : '',
  };
}

/**
 * One "something was created" card under the reply: what was made, when it fires, and the
 * way back to it. Green is the whole point: it has to read as good news at a glance and
 * never as a warning, so the stripe and the badge carry the tone before the text is read.
 */
function NotableCard({ card, onOpen }) {
  return (
    <div className="zuri-notable">
      <div className="zuri-notable-head">
        {card.badge !== '' && (
          <span className="zuri-notable-badge">
            <span className="zuri-notable-check" aria-hidden="true"><CheckIcon size={10} /></span>
            {card.badge}
          </span>
        )}
        {onOpen && (
          <Button type="button" className="zuri-notable-open" onPress={onOpen}>Open</Button>
        )}
      </div>
      <p className="zuri-notable-title">{card.title}</p>
      {card.lines.length > 0 && (
        <dl className="zuri-notable-lines">
          {card.lines.map((line, lineIndex) => (
            <div className="zuri-notable-line" key={`${line.label}-${lineIndex}`}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
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
/**
 * How tall a popover that opens upward may be.
 *
 * The model list and the + menu hang above the composer, and the composer is not always
 * at the bottom of the window: an empty chat centres it and the quick-ask card is short.
 * A fixed share of the window therefore still let the first rows sit above the top edge,
 * out of reach. Measuring the trigger when the popover opens turns the room actually
 * left above it into a scroll area instead.
 * @param {boolean} open
 * @param {import('react').RefObject<HTMLElement>} anchorRef Element the popover hangs above
 * @returns {number} Pixel cap for the popover, or 0 while it is closed.
 */
function usePopoverMaxHeight(open, anchorRef) {
  const [maxHeight, setMaxHeight] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const box = anchorRef.current?.getBoundingClientRect();
      if (!box) return;
      // 8px is the gap the popover keeps from its trigger and 12px the clearance from
      // the window edge; 120px keeps a usable sliver when the room left is tiny.
      setMaxHeight(Math.max(120, Math.round(box.top - 20)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, anchorRef]);
  return open ? maxHeight : 0;
}

export default function ChatPanel({ initialThreadId = '', onChatUpdated, onNavigate, compact = false, onNewChat, sidebarCollapsed = false, onToggleSidebar }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [draft, setDraft] = useState(() => {
    // "Make another" in the image library leaves the picture's words here for one read.
    try {
      const pending = window.sessionStorage.getItem(PENDING_IMAGE_PROMPT_KEY);
      if (pending) {
        window.sessionStorage.removeItem(PENDING_IMAGE_PROMPT_KEY);
        return pending;
      }
    } catch (error) {
      console.warn('[zuri:chat] pending image prompt', error?.message ?? error);
    }
    return '';
  });
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingFiles, setStreamingFiles] = useState([]);
  // Cards for what this turn created. They outlive the reply, because a to-do that was
  // just made is worth reading a moment longer, and are dropped when the next turn starts.
  const [notables, setNotables] = useState([]);
  const [replying, setReplying] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [listening, setListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(-1);
  // Which reply is being read aloud, so its button can offer Stop.
  const [speakingIndex, setSpeakingIndex] = useState(-1);
  const [stopping, setStopping] = useState(false);
  // Ask, Act or Autopilot, remembered on this computer. Only the full window shows the
  // picker, so the quick-ask card always sends Ask and can never change anything.
  const [mode, setMode] = useState(readChatMode);
  // A step waiting for the person's yes or no, and the item open in the side panel.
  const [approval, setApproval] = useState(null);
  const [panelItem, setPanelItem] = useState(null);
  const sendMode = compact ? 'ask' : mode;
  // The rewrite a person has now used often enough to be worth offering as their default.
  const [styleOffer, setStyleOffer] = useState(null);
  const [menuView, setMenuView] = useState('');
  // The picture ladder is fetched when the menu opens rather than on mount, and a
  // preview is kept per saved file so a picture shows without reading it back from
  // disk on every render.
  const [imageModels, setImageModels] = useState([]);
  const [imagePreviews, setImagePreviews] = useState({});
  const [imageBusy, setImageBusy] = useState('');
  // The prompt enhancer: `enhancing` covers the round trip, and `enhancedFrom` holds the
  // person's own words for as long as the rewritten ones are still in the message box,
  // so the same button can put them back.
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedFrom, setEnhancedFrom] = useState(null);
  // What the enhancer thought the message was missing: short lines the person can fold
  // into the prompt with one press. They sit under the box rather than in it, because
  // they are advice about the ask, not part of it until it is taken.
  const [enhanceSuggestions, setEnhanceSuggestions] = useState([]);
  const [imageShape, setImageShape] = useState(() => {
    const saved = readLocal(IMAGE_SHAPE_STORAGE_KEY, 'square');
    return IMAGE_SHAPES.some(([value]) => value === saved) ? saved : 'square';
  });
  const [improveImagePrompt, setImproveImagePrompt] = useState(() => readLocal(IMAGE_IMPROVE_STORAGE_KEY, 'on') !== 'off');
  const [answerLength, setAnswerLength] = useState('balanced');
  // On by default for current answers, then remembered when the person changes it.
  const [webSearch, setWebSearch] = useState(readWebSearchPreference);
  const [incognito, setIncognito] = useState(false);
  // The model chip. `pickedModelId` is what the person chose in this chat and wins
  // over the last reply's model; '' means nothing was picked here, which leaves the
  // model chosen in Settings in charge.
  const [pickedModelId, setPickedModelId] = useState('');
  const [settingsModelId, setSettingsModelId] = useState('');
  const [modelMenu, setModelMenu] = useState(false);
  const modelMenuRef = useRef(null);
  const menuRef = useRef(null);
  // Both popovers open upward, so their height follows the room left above the composer.
  const modelMenuMaxHeight = usePopoverMaxHeight(modelMenu, modelMenuRef);
  const addMenuMaxHeight = usePopoverMaxHeight(menuView !== '', menuRef);
  const composerRef = useRef(null);
  const scrollRef = useRef(null);
  // Starts true so opening a thread lands on its newest message.
  const stickToBottomRef = useRef(true);
  const recognitionRef = useRef(null);
  const voiceDraftRef = useRef('');
  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      const result = await api?.settings?.get?.();
      if (!active || !result?.ok) return;
      if (typeof result.data?.answerLength === 'string') setAnswerLength(result.data.answerLength);
      if (typeof result.data?.model === 'string') setSettingsModelId(result.data.model);
    };
    void loadSettings();
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

  /**
   * Follow turns another surface wrote into this thread.
   *
   * A chat continued in the browser is synced into chats.json by the main process,
   * which then announces area 'chats'. Nothing else re-reads the open transcript, so
   * without this the reply someone just wrote in the browser would stay missing until
   * the chat was closed and reopened. Only a longer stored thread replaces what is on
   * screen: a shorter one means a reply here is still being written, and swapping it
   * out would swallow the person's own text.
   */
  useEffect(() => {
    const stopListening = api?.state?.onChanged?.((change) => {
      if (change?.area !== 'chats' || threadId === '' || replying) return;
      void (async () => {
        const result = await api.chats.list();
        const thread = result?.ok ? result.data?.find((entry) => entry?.id === threadId) : null;
        if (!thread || !Array.isArray(thread.messages)) return;
        setMessages((previous) => (thread.messages.length > previous.length ? thread.messages : previous));
      })();
    });
    return () => { stopListening?.(); };
  }, [api, threadId, replying]);


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
      // A created task, reminder or automation arrives as a finished card, already
      // built by the same description the web chat paints.
      const notable = notableFrom(event);
      if (notable !== null) setNotables((current) => [...current, notable]);
      if (event.approval && typeof event.approval.id === 'string') setApproval(event.approval);
      // Main closes a card itself when the step timed out or Stop was pressed.
      if (typeof event.approvalClosed === 'string') {
        setApproval((current) => (current?.id === event.approvalClosed ? null : current));
      }
      if (event.done === true) {
        setReplying(false);
        setActivity('');
        setApproval(null);
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

  /** Read one reply aloud, or stop if that same reply is already being read. */
  function toggleSpeech(message, index) {
    if (speakingIndex === index) {
      stopSpeaking();
      setSpeakingIndex(-1);
      return;
    }
    const started = speak(String(message?.content ?? ''), {
      onEnd: () => setSpeakingIndex((current) => (current === index ? -1 : current)),
    });
    if (!started) {
      setError('This computer has no voice available to read the reply aloud.');
      return;
    }
    setSpeakingIndex(index);
  }

  // Leaving the chat, or switching to another one, must not leave a voice talking.
  useEffect(() => () => stopSpeaking(), []);

  /**
   * Put an earlier prompt back in the composer so it can be corrected and sent
   * again without rewriting the saved transcript or losing the original wording.
   */
  function editPrompt(message) {
    const content = typeof message?.content === 'string' ? message.content : '';
    if (content.trim() === '' || replying) return;
    setDraft(content);
    setAttachment(null);
    setError('');
    window.requestAnimationFrame(() => composerRef.current?.focus());
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

  /**
   * Attach a picture from the clipboard the way the paperclip attaches a picked
   * file: main writes the bytes into the workspace and answers with the file it
   * made, so an attachment keeps one shape whatever the picture came from.
   * @param {File} file
   * @returns {Promise<void>}
   */
  async function attachPastedImage(file) {
    if (typeof api?.files?.savePasted !== 'function') {
      setError('Pasting an image is only available inside the Zuri app.');
      return;
    }
    const fromType = PASTE_EXTENSION_BY_TYPE[String(file.type ?? '').toLowerCase()];
    const fromName = typeof file.name === 'string' && isImageName(file.name) ? file.name.split('.').pop().toLowerCase() : '';
    const extension = fromType ?? fromName;
    if (extension === '') {
      setError('Paste a PNG, JPG, WEBP or GIF image.');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const saved = await api.files.savePasted({ name: `pasted.${extension}`, bytes });
      if (!saved?.ok || typeof saved.data?.path !== 'string') {
        setError(saved?.error?.message ?? 'That image could not be attached.');
        return;
      }
      setAttachment({ name: saved.data.name, path: saved.data.path, size: saved.data.size });
      setError('');
    } catch (error) {
      console.warn('[zuri:chat] pasted image', error?.message ?? error);
      setError('That image could not be read from the clipboard.');
    }
  }

  /**
   * Take a picture pasted into the composer.
   *
   * Only a paste that really carries an image is intercepted, so copying and
   * pasting text keeps the browser's own paste character for character.
   * @param {import('react').ClipboardEvent<HTMLTextAreaElement>} event
   */
  function handleComposerPaste(event) {
    const file = pastedImageFile(event.clipboardData);
    if (file === null) return;
    // The picture replaces the text: without this Chromium inserts the image's
    // own file name into the message instead.
    event.preventDefault();
    // A reply on its way owns the transcript, so nothing is attached until it
    // lands, which is the rule the paperclip already follows.
    if (replying) return;
    void attachPastedImage(file);
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
  /**
   * Rewrite the message box into a clearer prompt, or put the person's own words back.
   *
   * The rewrite replaces the draft instead of being sent, so it can be read, edited or
   * thrown away first, and the same button undoes it. Editing the text by hand clears
   * the undo, because restoring then would discard what they just typed.
   * @returns {Promise<void>}
   */
  async function improvePrompt() {
    if (enhancing) return;
    if (enhancedFrom !== null) {
      setDraft(enhancedFrom);
      setEnhanceSuggestions([]);
      setEnhancedFrom(null);
      setError('');
      return;
    }
    const prompt = draft.trim();
    if (prompt === '') {
      setError('Write the message you want improved first.');
      return;
    }
    if (replying || imageBusy !== '') return;
    if (typeof api?.prompts?.enhance !== 'function') {
      setError('The prompt enhancer is only available inside the Zuri app.');
      return;
    }

    setError('');
    setMenuView('');
    setEnhanceSuggestions([]);
    setEnhancing(true);
    try {
      const result = await api.prompts.enhance({ prompt });
      const improved = result?.ok === true && typeof result.data?.prompt === 'string' ? result.data.prompt.trim() : '';
      if (improved === '') {
        setError(result?.error?.message ?? 'That message could not be improved. Try again.');
        return;
      }
      setEnhancedFrom(draft);
      // Only a list of lines is shown; anything else from the account is ignored rather
      // than drawn as an empty row.
      setEnhanceSuggestions(
        Array.isArray(result.data?.suggestions)
          ? result.data.suggestions.filter((suggestion) => typeof suggestion === 'string' && suggestion.trim() !== '')
          : [],
      );
      setDraft(improved);
      // The cursor goes to the end, so the person can carry on from what was written
      // for them rather than hunting for the caret.
      requestAnimationFrame(() => {
        const box = composerRef.current;
        if (box && typeof box.focus === 'function') {
          box.focus();
          const end = box.value.length;
          if (typeof box.setSelectionRange === 'function') box.setSelectionRange(end, end);
        }
      });
    } catch (thrown) {
      setError(thrown?.message ?? 'That message could not be improved. Try again.');
    } finally {
      setEnhancing(false);
    }
  }

  /**
   * Fold one suggested addition into the prompt.
   *
   * The line joins the message on its own line, so it reads as the requirement it is,
   * and it leaves the list: the same detail is not offered twice. The caret stays in
   * the box, at the end, ready for the next thing they want to say.
   * @param {string} suggestion
   * @returns {void}
   */
  function addSuggestion(suggestion) {
    setDraft((current) => {
      const base = current.replace(/\s+$/, '');
      if (base.includes(suggestion)) return base;
      return base === '' ? suggestion : `${base}\n${suggestion}`;
    });
    setEnhanceSuggestions((list) => list.filter((item) => item !== suggestion));
    requestAnimationFrame(() => {
      const box = composerRef.current;
      if (box && typeof box.focus === 'function') {
        box.focus();
        const end = box.value.length;
        if (typeof box.setSelectionRange === 'function') box.setSelectionRange(end, end);
      }
    });
  }

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
      const made = await api.images.generate({ prompt, modelCode: model.code, shape: imageShape, improve: improveImagePrompt });
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
      setEnhanceSuggestions([]);
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
    // A card belongs to the turn that made it, so it never carries over to the next one.
    setNotables([]);
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
          ...((localOnly || incognito) ? { localOnly: true } : {}),
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
        mode: sendMode,
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
      setApproval(null);
    }
  }

  /**
   * Write the newest reply again.
   *
   * Main drops the old reply first so the model answers the person's last message,
   * not its own earlier answer. If the new reply fails or is stopped, the stored chat
   * no longer has the old one, so the transcript is re-read from the store rather
   * than left showing a reply that is gone.
   */
  async function regenerateReply() {
    if (replying || threadId === '' || typeof api?.chat?.send !== 'function') return;

    setError('');
    setStreamingText('');
    setStreamingFiles([]);
    setNotables([]);
    setReplying(true);
    setMessages((current) => (current.at(-1)?.role === 'assistant' ? current.slice(0, -1) : current));

    try {
      const result = await api.chat.send({
        threadId,
        webSearch,
        mode: sendMode,
        regenerate: true,
        ...(chatModel !== null ? { model: { provider: chatModel.provider, model: chatModel.model } } : {}),
      });
      if (result?.ok) {
        setMessages(Array.isArray(result.data?.thread?.messages) ? result.data.thread.messages : []);
        onChatUpdated?.();
        return;
      }
      if (result?.error?.code !== 'CHAT_STOPPED') setError(result?.error?.message ?? 'Zuri could not respond. Try again.');
      const listed = await api.chats.list();
      const stored = listed?.ok ? listed.data?.find((entry) => entry?.id === threadId) : null;
      if (stored && Array.isArray(stored.messages)) setMessages(stored.messages);
    } catch (sendError) {
      setError(sendError?.message ?? 'Zuri could not respond.');
    } finally {
      setStreamingText('');
      setStreamingFiles([]);
      setReplying(false);
      setStopping(false);
      setApproval(null);
    }
  }

  /** The person's answer to the step Zuri is waiting on. */
  function answerApproval(approved) {
    if (approval === null) return;
    void api?.chat?.approve?.({ id: approval.id, approved });
    setApproval(null);
  }

  function chooseMode(next) {
    setMode(next);
    saveChatMode(next);
  }

  /** Show a block of code from an answer in the side panel. */
  function openCodeInPanel(block) {
    setPanelItem({ title: block.language || 'Code', subtitle: 'From the answer', text: block.text });
  }

  /** Read a file Zuri made and show its text in the side panel. */
  async function previewFile(file) {
    setPanelItem({ title: file.name, subtitle: FILE_KIND_LABELS[file.kind] ?? 'File', text: '', loading: true, file });
    if (typeof api?.tools?.run !== 'function') {
      setPanelItem({ title: file.name, text: '', error: 'Previews need the Zuri desktop app.', file });
      return;
    }
    const read = await api.tools.run({ name: 'readFile', args: { path: file.path } });
    const text = read?.ok && typeof read.data?.text === 'string' ? read.data.text : '';
    setPanelItem({
      title: file.name,
      subtitle: FILE_KIND_LABELS[file.kind] ?? 'File',
      text,
      error: text === '' ? (read?.error?.message ?? 'There is nothing to show for this file. Use Open to see it in its own app.') : '',
      file,
    });
  }

  async function sendMessage(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if ((prompt === '' && !attachment) || replying) return;

    setDraft('');
    setEnhanceSuggestions([]);
    if (listening) recognitionRef.current?.stop();
    // Held from here so a second click during the file read cannot send twice.
    setReplying(true);

    let content = prompt || 'Please analyze the attached file.';
    let image = null;
    const attachedImage = attachment && attachment.kind !== 'folder' && isImageName(attachment.name);
    if (attachedImage && chatModel !== null && chatModel.supportsImages !== true) {
      setError('This model cannot read images. Choose Zuri Core, Zuri Reason or Zuri Elite to attach a picture.');
      setReplying(false);
      return;
    }
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
    await runTurn(content, prompt || attachment?.name || 'New chat', image, attachment !== null || incognito);
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

  function exportChat() {
    if (messages.length === 0) return;
    const text = messages
      .map((message) => `${message.role === 'assistant' ? 'Zuri' : 'You'}:\n${String(message.content ?? '').trim()}`)
      .join('\n\n');
    const blob = new Blob([`# Zuri chat\n\n${text}\n`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'zuri-chat.md';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
        <div className="zuri-chat-float zuri-chat-float-right flex gap-1">
          {hasConversation && <Button isIconOnly variant="ghost" aria-label="Export chat" title="Export chat" onPress={exportChat}><DownloadIcon size={19} /></Button>}
          <Button isIconOnly variant="ghost" aria-label="New chat" title="New chat" onPress={onNewChat}><NewChatIcon size={19} /></Button>
        </div>
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
      <div className={`flex min-h-0 flex-1 flex-col items-center px-4 sm:px-6 ${panelItem !== null ? 'lg:pr-[28.5rem]' : ''} ${compact ? 'zuri-overlay-content justify-end p-3' : hasConversation ? 'justify-end pb-4 pt-4 sm:pb-6 sm:pt-6' : 'justify-center pb-10 sm:pb-24'}`}>
        {!compact && !hasConversation && (
          // One line and the composer below it, the way ChatGPT opens: nothing competes with the box.
          <div className={`mb-8 flex w-full ${contentWidth} flex-col items-center`}>
            <span className="zuri-logo-badge mb-5" aria-hidden="true"><img src={zuriMarkUrl} alt="" width={52} height={52} className="zuri-chat-mark" decoding="async" /></span>
            <h1 className="text-center text-3xl font-normal tracking-tight sm:text-4xl">{OPENING_HEADING}</h1>
            <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
              {OPENING_IDEAS.map((idea) => (
                <Button key={idea.label} type="button" variant="secondary" className="min-h-11 rounded-full px-4 text-sm" onPress={() => insertCommand(idea.text)}>{idea.label}</Button>
              ))}
            </div>
          </div>
        )}

        {hasConversation && (
          <div ref={scrollRef} onScroll={handleTranscriptScroll} className={`zuri-scrollbar-hidden mb-4 flex w-full ${contentWidth} min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto ${compact ? 'py-4' : 'pb-4 pt-14'}`}>
            {messages.map((message, index) => (
              message.role === 'user' ? (
                <div key={messageKey(message, index)} className="flex min-w-0 max-w-[85%] flex-col items-end gap-1 self-end">
                  <div className="zuri-message-user-bubble min-w-0 break-words rounded-2xl px-4 py-3 text-sm">
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
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 rounded-lg text-muted"
                      aria-label="Edit prompt"
                      title="Edit prompt"
                      onPress={() => editPrompt(message)}
                    >
                      <EditIcon size={14} />
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
                  <div className="zuri-message-assistant-bubble min-w-0 break-words px-4 py-3 text-sm text-foreground">
                    <FormattedMessage content={message.content} onOpenCode={compact ? undefined : openCodeInPanel} />
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
                      <FileCard file={file} api={api} onPreview={compact ? undefined : previewFile} />
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
                    {speechAvailable() && !(message.files ?? []).some((file) => file?.kind === 'image') && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 rounded-lg text-muted"
                        aria-label={speakingIndex === index ? 'Stop reading aloud' : 'Read reply aloud'}
                        title={speakingIndex === index ? 'Stop reading aloud' : 'Read aloud'}
                        onPress={() => toggleSpeech(message, index)}
                      >
                        {speakingIndex === index ? <StopIcon size={14} /> : <SpeakIcon size={14} />}
                      </Button>
                    )}
                    {/* A picture reply was drawn by an image model, not written by the chat
                        model, so writing it again would swap the picture for text. */}
                    {index === lastAnswerIndex && !replying && !(message.files ?? []).some((file) => file?.kind === 'image') && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 rounded-lg text-muted"
                        aria-label="Regenerate reply"
                        title="Write this reply again"
                        onPress={() => void regenerateReply()}
                      >
                        <RegenerateIcon size={14} />
                      </Button>
                    )}
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
                {streamingFiles.map((file) => <FileCard key={file.path} file={file} api={api} onPreview={compact ? undefined : previewFile} />)}
              </div>
            )}
            {/* Under the reply and above the activity line: the card is part of the answer,
                not a status message about it. Each card offers Open only where there is a
                section to open, which is why the quick-ask overlay draws no button. */}
            {notables.length > 0 && (
              <div className="flex w-full max-w-[85%] flex-col gap-2 self-start">
                {notables.map((card, cardIndex) => (
                  <NotableCard
                    key={card.id !== '' ? card.id : `${cardIndex}-${card.title}`}
                    card={card}
                    onOpen={typeof onNavigate === 'function' && NOTABLE_VIEWS.includes(card.action)
                      ? () => onNavigate(card.action)
                      : undefined}
                  />
                ))}
              </div>
            )}
            {replying && activity !== '' && <p className="self-start text-sm text-muted">{activity}...</p>}
            {replying && streamingText === '' && activity === '' && <p className="self-start text-sm text-muted">Zuri is thinking...</p>}
            {imageBusy !== '' && <p role="status" className="self-start text-sm text-muted">{imageBusy} is drawing your picture...</p>}
          </div>
        )}

        <div className={`w-full ${contentWidth} ${compact ? 'zuri-overlay-composer-wrap' : ''}`}>
          {error !== '' && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          {incognito && <p role="status" className="mb-2 text-sm text-muted">Incognito chat: this conversation stays on this device and is not synced.</p>}
          {approval !== null && <ApprovalCard approval={approval} onAnswer={answerApproval} />}
          {styleOffer !== null && (
            <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
              <span className="flex-1">Make that your default for every answer?</span>
              <Button size="sm" variant="primary" onPress={() => void saveStyleDefault()}>Yes, save it</Button>
              <Button size="sm" variant="ghost" onPress={dismissStyleOffer}>Not now</Button>
            </div>
          )}
          {enhanceSuggestions.length > 0 && (
            // What the enhancer thought was missing. Each line is a press away from
            // joining the message, so the person takes only what is true for them.
            <div role="group" aria-label="Suggested additions to your prompt" className="mb-2 flex flex-col gap-0.5">
              <p className="px-1 pb-0.5 text-xs font-semibold text-muted">Add to your prompt</p>
              {enhanceSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="ghost"
                  title="Add this line to your message"
                  className="flex w-full items-start justify-start gap-1.5 rounded-none px-1.5 py-1.5 text-left text-[13px] font-normal leading-snug hover:bg-surface-secondary"
                  onPress={() => addSuggestion(suggestion)}
                >
                  <PlusIcon size={14} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 break-words">{suggestion}</span>
                </Button>
              ))}
            </div>
          )}
          <form onSubmit={sendMessage} className={`flex items-end gap-2 rounded-3xl border border-border bg-surface px-3 py-2 shadow-sm ${compact ? 'zuri-overlay-composer' : ''}`}>
            <div ref={menuRef} className="relative">
              <Button type="button" isIconOnly size="sm" variant="ghost" aria-label="Add to message" aria-haspopup="menu" aria-expanded={menuView !== ''} title="Add files, photos or a command" onPress={() => setMenuView((current) => (current === '' ? 'main' : ''))}>
                <PlusIcon />
              </Button>
              {/* The list opens upward out of the composer, so on a short window its first
                  row would sit above the top edge. The viewport cap lets it scroll
                  instead, so no row becomes unreachable. */}
              {menuView !== '' && (
                <div role="menu" aria-label="Add to message" className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-1 shadow-lg" style={addMenuMaxHeight ? { maxHeight: addMenuMaxHeight } : undefined}>
                  {menuView === 'main' ? (
                    <>
                      <Button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => pickMenuItem(() => void chooseAttachment())}>
                        <PaperclipIcon size={16} />
                        <span>Add files or photos</span>
                      </Button>
                      <Button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => pickMenuItem(() => void chooseFolder())}>
                        <FolderIcon size={16} />
                        <span>Add folder</span>
                      </Button>
                      <Button type="button" role="menuitemcheckbox" aria-checked={webSearch} title="Lets Zuri search the web and read pages. Each lookup is an extra request to your provider." className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => { const next = !webSearch; setWebSearch(next); saveWebSearchPreference(next); }}>
                        <GlobeIcon size={16} />
                        <span className="flex-1">Search the web</span>
                        {webSearch && <CheckIcon size={16} />}
                      </Button>
                      <Button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" title="Draw a picture with one of Zuri's image models" onPress={() => pickMenuItem(() => { void loadImageModels(); setMenuView('image'); })}>
                        <ImageIcon size={16} />
                        <span className="flex-1">Create an image</span>
                      </Button>
                      <Button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => setMenuView('length')}>
                        <SlashCommandIcon size={16} />
                        <span className="flex-1">Reply length</span>
                        <span className="text-xs text-muted capitalize">{answerLength}</span>
                      </Button>
                      <Button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => setMenuView('commands')}>
                        <SlashCommandIcon size={16} />
                        <span>Slash commands</span>
                      </Button>
                      <Button type="button" role="menuitemcheckbox" aria-checked={incognito} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => { if (!incognito) onNewChat?.(); setIncognito((current) => !current); }}>
                        <span className="flex-1">Incognito chat</span>
                        {incognito && <CheckIcon size={16} />}
                      </Button>
                    </>
                  ) : menuView === 'image' ? (
                    <div className="flex flex-col gap-1">
                      <div role="radiogroup" aria-label="Picture shape" className="flex gap-1 px-2 pb-1">
                        {IMAGE_SHAPES.map(([value, label]) => (
                          <Button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={imageShape === value}
                            className={`min-h-9 flex-1 rounded-lg px-2 text-xs ${imageShape === value ? 'zuri-selected-pill' : 'text-muted hover:bg-surface-secondary'}`}
                            onPress={() => { setImageShape(value); writeLocal(IMAGE_SHAPE_STORAGE_KEY, value); }}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 px-3 pb-1 text-xs text-muted" title="Zuri rewrites your description into a better prompt for the picture maker. The picture library shows both.">
                        <Checkbox
                          aria-label="Improve my description"
                          checked={improveImagePrompt}
                          onChange={(selected) => { setImproveImagePrompt(selected); writeLocal(IMAGE_IMPROVE_STORAGE_KEY, selected ? 'on' : 'off'); }}
                        />
                        Improve my description
                      </div>
                      {imageModels.length === 0 && <p className="px-3 py-2 text-xs text-muted">Checking which picture models you can use...</p>}
                      {imageModels.map((model) => (
                        <Button
                          key={model.code}
                          type="button"
                          role="menuitem"
                          isDisabled={!model.available || imageBusy !== ''}
                          title={`${model.hint}. About NGN ${model.nairaPerImage} an image.`}
                          className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary disabled:opacity-40"
                          onPress={() => void createImage(model)}
                        >
                          <span className="flex w-full items-center gap-2">
                            <ImageIcon size={15} />
                            {model.name}
                            <span className="ml-auto text-xs text-muted">NGN {model.nairaPerImage}</span>
                          </span>
                          <span className="text-xs text-muted">{model.hint}</span>
                        </Button>
                      ))}
                    </div>
                  ) : menuView === 'length' ? (
                    [['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']].map(([value, label]) => (
                      <Button key={value} type="button" role="menuitemradio" aria-checked={answerLength === value} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => pickMenuItem(() => void chooseAnswerLength(value))}>
                        <span className="flex-1">{label}</span>
                        {answerLength === value && <CheckIcon size={16} />}
                      </Button>
                    ))
                  ) : (
                    SLASH_COMMANDS.map((command) => (
                      <Button key={command.label} type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary" onPress={() => pickMenuItem(() => insertCommand(command.text))}>
                        <SlashCommandIcon size={16} />
                        <span>{command.label}</span>
                      </Button>
                    ))
                  )}
                </div>
              )}
            </div>
            <ComposerTextarea
              ref={composerRef}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); if (enhancedFrom !== null) setEnhancedFrom(null); }}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              placeholder="Ask Zuri"
              aria-label="Message Zuri"
              rows={1}
              className="composer-textarea min-h-10 min-w-0 flex-1 max-h-48 py-2 text-base outline-none"
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
            {!compact && <ModeMenu mode={mode} onChange={chooseMode} />}
            {!compact && (
            <div ref={modelMenuRef} className="relative shrink-0">
              <Button
                type="button"
                aria-haspopup="menu"
                aria-expanded={modelMenu}
                aria-label={`Chat model: ${chatModelLabel}`}
                title={`${chatModelLabel}${chatModel !== null ? `. ${chatModel.note}` : ''} Change the model for this chat.`}
                className="zuri-chat-model-trigger flex h-10 max-w-32 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted outline-none hover:text-foreground focus:ring-2 focus:ring-accent/30"
                onPress={() => {
                  // The picture names are fetched the first time the list opens, so a chat
                  // that never draws a picture never asks the app for them.
                  if (!modelMenu) void loadImageModels();
                  setModelMenu((open) => !open);
                }}
              >
                <span className="zuri-chat-model-label-full truncate">{chatModelLabel}</span>
                <span className="zuri-chat-model-label-short truncate" aria-hidden="true">
                  {chatModelLabel.replace(/^Zuri\s+/, '')}
                </span>
                <ChevronDownIcon size={12} />
              </Button>
              {/* Chat models first, then picture models, so the same popup can also draw.
                  It opens upward too, so it carries the same viewport cap and scrolls. */}
              {modelMenu && (
                <div role="menu" aria-label="Chat model" className="absolute bottom-full right-0 z-20 mb-2 w-64 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-1 shadow-lg" style={modelMenuMaxHeight ? { maxHeight: modelMenuMaxHeight } : undefined}>
                  <p className="px-3 pb-1 pt-2 text-xs text-muted">Zuri answers this chat with:</p>
                  {ZURI_MODELS.map((entry) => (
                    <Button
                      key={entry.model}
                      type="button"
                      role="menuitemradio"
                      aria-checked={entry.name === chatModelLabel}
                      className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary"
                      onPress={() => pickModel(entry)}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="flex-1 truncate">{entry.name}</span>
                        {entry.model === chatModelId && <CheckIcon size={15} />}
                      </span>
                      <span className="text-xs text-muted">{entry.note}{entry.supportsImages ? ' Reads images.' : ''}</span>
                    </Button>
                  ))}
                  {/* A picture row does not answer with text: it draws what the message box
                      says, through the same handler the + menu's image list uses. */}
                  {imageModels.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-xs text-muted">Draw a picture</p>
                      {imageModels.map((model) => (
                        <Button
                          key={model.code}
                          type="button"
                          role="menuitem"
                          isDisabled={!model.available || imageBusy !== ''}
                          title={`${model.hint}. About NGN ${model.nairaPerImage} an image.`}
                          className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-secondary disabled:opacity-40"
                          onPress={() => { setModelMenu(false); void createImage(model); }}
                        >
                          <span className="flex w-full items-center gap-2">
                            <ImageIcon size={15} />
                            <span className="truncate">{model.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted">NGN {model.nairaPerImage}</span>
                          </span>
                          <span className="text-xs text-muted">{model.hint}</span>
                        </Button>
                      ))}
                    </>
                  )}
                  <p className="px-3 pb-1 pt-2 text-xs text-muted">Billed to your Zuri plan, like every other reply.</p>
                </div>
              )}
            </div>
            )}
            {/* Beside Send: one press rewrites the message box into a clearer prompt,
                and a second puts the person's own words back before it is sent. */}
            <Button
              type="button"
              isIconOnly
              size="sm"
              variant="ghost"
              className={`h-10 w-10 rounded-full p-0 ${enhancedFrom !== null ? 'text-accent' : 'text-muted'}`}
              aria-label={enhancedFrom !== null ? 'Undo the improved prompt' : 'Improve the prompt'}
              title={enhancedFrom !== null ? 'Put your own words back' : 'Rewrite this as a clearer prompt'}
              onPress={() => void improvePrompt()}
              isDisabled={enhancing || draft.trim() === ''}
            >
              <EnhanceIcon size={17} className={enhancing ? 'animate-pulse' : ''} />
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
              <Button type="submit" isIconOnly size="sm" variant="primary" className="zuri-send-button h-10 w-10 rounded-full p-0 shadow-md disabled:opacity-40" aria-label="Send" isDisabled={draft.trim() === '' && !attachment}>
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
      {/* Beside the conversation on a wide window and over it on a narrow one, so a
          result never squeezes the chat below a readable width. */}
      {!compact && panelItem !== null && <ResultPanel item={panelItem} api={api} onClose={() => setPanelItem(null)} />}
    </main>
  );
}
