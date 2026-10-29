import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Textarea } from 'flowbite-react';
import { AlignLeftIcon, ArchiveIcon, CheckIcon, ChevronLeftIcon, ChevronUpIcon, CloseIcon, CommandIcon, CopyIcon, DeleteIcon, EditIcon, FileIcon, FolderIcon, ICON_SIZE, MoreIcon, PaperclipIcon, PinIcon, PlusIcon, RegenerateIcon, SendIcon, ShareIcon, StopIcon } from '../../../src/renderer-react/Icons.jsx';
import { Button, IconButton, InlineAlert } from '../components/ui.jsx';
import ConversationSearch from '../components/ConversationSearch.jsx';
import { LogoMark } from '../components/Icons.jsx';
// The reply renderer and the clipboard fallback are the desktop app's own modules,
// imported rather than copied: an answer is then drawn by one set of markdown rules
// on both surfaces, and the code block's own copy button behaves the same way.
import FormattedMessage from '../../../src/renderer-react/FormattedMessage.jsx';
import { copyText } from '../../../src/renderer-react/clipboard.js';
import { shareText } from '../lib/share.js';
import {
  DEFAULT_CHAT_MODEL,
  appendMessage,
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchProjects,
  renameConversation,
  setConversationFlags,
  setConversationProject,
  signUpload,
  streamChat,
  uploadAttachment,
} from '../lib/api.js';
import { formatRelativeTime, greetingFor } from '../lib/format.js';
import { clearChatDraft, readChatDraft, saveChatDraft } from '../lib/drafts.js';

/*
 * The chat models a customer can choose, in the order the plans climb. The codes
 * are the server's own (`server/src/models.js`); a plan that does not include one
 * is refused by the server, and that message is shown exactly as it arrives
 * rather than restated here.
 */
const CHAT_MODELS = [
  { code: 'zuri-flash', name: 'Zuri Flash' },
  { code: 'zuri-pro', name: 'Zuri Pro' },
  { code: 'zuri-max', name: 'Zuri Max' },
  { code: 'zuri-code', name: 'Zuri Core' },
  { code: 'zuri-reason', name: 'Zuri Reason' },
  { code: 'zuri-elite', name: 'Zuri Elite' },
];

/*
 * Only the tail of a long chat is sent with each question: the server accepts at
 * most fifty turns, and every one of them is spent against the plan's input
 * allowance, so a whole afternoon of history would cost more than the answer.
 */
const HISTORY_LIMIT = 20;

/*
 * The three reply lengths, with the instruction each one adds to the question.
 * The wording is the desktop app's own (`src/main/providers/chat.js`) so the same
 * choice reads the same way on both surfaces. The cloud route carries no system
 * prompt, so the rule travels with the message and is not saved with it.
 */
const ANSWER_LENGTH_CHOICES = [
  ['concise', 'Concise', 'short'],
  ['balanced', 'Balanced', 'default'],
  ['detailed', 'Detailed', 'thorough'],
];

const ANSWER_LENGTH_RULES = {
  concise: 'Length: as short as the question allows. Answer in one or two sentences, then at most three short bullets, and leave out background nobody asked for.',
  balanced: 'Length: complete but not padded. The direct answer first, then the reasoning, the key steps or an example, and any caveat that changes what the person should do. Greetings and simple factual questions still get a short reply.',
  detailed: 'Length: thorough. The direct answer first, then the reasoning, steps, caveats, alternatives and worked examples that support it. Use headings once the answer has more than three sections.',
};

/*
 * Each command only fills the composer with a starter sentence, so nothing is
 * sent until the person finishes the sentence and presses Send. Same list as the
 * desktop composer, minus the ones only the desktop can carry out.
 */
const SLASH_COMMANDS = [
  { label: 'Summarise', text: 'Summarise this: ' },
  { label: 'Make a task', text: 'Turn this into a task: ' },
  { label: 'Set a reminder', text: 'Remind me to ' },
  { label: 'Draft a reply', text: 'Draft a reply to this: ' },
];

/* One row of the add menu. A menu item is a button, not a link, because nothing
   here navigates: each row changes the message being written. */
function MenuItem({ children, onSelect, role = 'menuitem', checked, className = '' }) {
  return (
    <Button
      type="button"
      variant="ghost"
      role={role}
      aria-checked={role === 'menuitemradio' ? checked : undefined}
      className={`chat-menu-row ${className}`.trim()}
      onClick={onSelect}
    >
      {children}
    </Button>
  );
}

/* A sub-list's header, doubling as the way back to the main list. */
function MenuBack({ children, onBack }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="chat-menu-back"
      onClick={onBack}
    >
      <ChevronLeftIcon size={14} aria-hidden="true" />
      {children}
    </Button>
  );
}

/*
 * What the browser can attach.
 *
 * Two routes, because two kinds of file mean different things. A picture or a PDF
 * has no useful text, so it is uploaded to Cloudinary and the message carries a
 * link to it: the CDN stores and serves the bytes, and the account stores only the
 * link. A text file is read here and its words travel inside the message, which
 * keeps a small note cheap and searchable.
 */
const ATTACHMENT_TYPES = /.(txt|text|md|markdown|csv|tsv|json|log|yml|yaml|html|css|js|jsx|ts|tsx|py|sql|xml)$/i;
const ATTACHMENT_MAX_BYTES = 200_000;
/** The server's cap, repeated here so an oversized file is refused before it is read. */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** The kinds Cloudinary is signed for; matching image/png, image/jpeg, image/webp, image/gif, application/pdf. */
const UPLOAD_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

/**
 * The name a model code is shown under. The picker already holds the names, but the
 * composer's chip reads this so a code saved by an older build still shows a name
 * rather than a bare supplier id.
 * @param {string} code
 * @returns {string}
 */
function modelNameFor(code) {
  const found = CHAT_MODELS.find((entry) => entry.code === code);
  if (found) return found.name;
  const words = String(code ?? '').replace(/^zuri-/, '').replace(/[-_]+/g, ' ').trim();
  return words === '' ? 'Zuri' : `Zuri ${words.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
}

/** Epoch milliseconds for a conversation, or 0 when the server sent no usable date. */
function stamp(conversation) {
  const value = conversation?.updatedAt ?? conversation?.createdAt ?? 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Newest first, whatever order the server answered in. */
/*
 * ChatGPT puts a long history under period headings, so a week of chats reads as
 * a few stretches rather than one undifferentiated list. The heading is attached
 * to the first chat of each stretch and drawn by the row's own CSS, which keeps
 * markup and behaviour apart.
 */
function dayBucket(conversation) {
  const when = stamp(conversation);
  if (!when) return 'Older';
  const days = Math.floor((Date.now() - when) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 days';
  if (days <= 30) return 'Previous 30 days';
  return 'Older';
}

function withGroupHeadings(conversations, searching) {
  let previous = '';
  return conversations.map((conversation) => {
    // A search result list is answering one question, so period headings would
    // only push the matches apart.
    const bucket = searching ? '' : dayBucket(conversation);
    const heading = bucket === previous ? '' : bucket;
    previous = bucket;
    return { conversation, heading };
  });
}

function newestFirst(conversations) {
  return [...conversations].sort((left, right) => stamp(right) - stamp(left));
}

/** A saved chat is named from its first question, which is enough to recognise it later. */
function titleFromQuestion(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}...`;
}

/**
 * Only the two roles a bubble can show. A stored tool turn is part of the machine
 * side of a reply, so it is left out rather than printed as if Zuri had said it.
 */
function chatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
      // A turn may carry one uploaded file. It is passed through as the server
      // sent it, and the bubble decides how to draw it.
      attachment: message.attachment ?? null,
    }));
}

/** The failure a screen shows: the server's own sentence and status, never a guess. */
function failureOf(error, fallback) {
  return { message: error?.message || fallback, status: Number(error?.status) || 0 };
}

/**
 * Chat with saved history.
 *
 * Two panes: the account's conversations on the left, the open one on the right.
 * Below 900px only one pane is on screen at a time, because a 390px window has no
 * room for both, and the open chat carries a back button to the list.
 */
export default function ChatView({
  onSignIn,
  userName = '',
  navigation = null,
  navCollapsed = false,
  onToggleCollapsed = () => {},
  // When the dashboard opens chat from inside a project, that project's id arrives
  // here. Every new thread is then filed into it, and the list only shows its own.
  projectId = '',
  projectName = '',
  onLeaveProject = null,
}) {
  const [conversations, setConversations] = useState([]);
  const [listStatus, setListStatus] = useState('loading');
  const [listError, setListError] = useState(null);
  const [conversationQuery, setConversationQuery] = useState('');

  const [openId, setOpenId] = useState(null);
  // A new chat has no conversation row yet: it is created on the first send.
  const [composing, setComposing] = useState(false);
  /*
   * A phone fits one pane at a time, so the saved chats are a screen of their own
   * there and need a close control. True keeps that screen in front, as it was
   * before this state existed. A wide screen docks both panes side by side and
   * never reads it.
   */
  const [listOpen, setListOpen] = useState(true);
  const [thread, setThread] = useState({ title: 'New chat', messages: [] });
  const [threadStatus, setThreadStatus] = useState('idle');
  const [threadError, setThreadError] = useState(null);

  const [draft, setDraft] = useState(() => readChatDraft());
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [streaming, setStreaming] = useState(false);
  const [streamReply, setStreamReply] = useState('');
  const [streamError, setStreamError] = useState(null);
  const [saveWarning, setSaveWarning] = useState('');
  // One file at a time, as the desktop composer allows, so the message stays one turn.
  const [attachment, setAttachment] = useState(null);
  const [attachNote, setAttachNote] = useState('');
  // '' keeps the add menu closed. The desktop composer's own three views, minus
  // the image list, which needs a route the cloud API does not have.
  const [menuView, setMenuView] = useState('');
  const [answerLength, setAnswerLength] = useState('balanced');
  // The model list is its own popup, anchored to its own chip. It is not a
  // floating-ui panel because that drifted off the trigger when the chip shrank
  // to a few characters on a phone.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  // Which chat row has its actions menu open. Only one at a time, as ChatGPT does.
  const [rowMenuId, setRowMenuId] = useState(null);
  // The row menu's project list is a second view inside the same menu, so choosing
  // where a chat belongs does not open a dialog over the conversation.
  const [projectPickerFor, setProjectPickerFor] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectsStatus, setProjectsStatus] = useState('');
  const [filingId, setFilingId] = useState('');
  // Which bubble was just copied, so its button can say so for a moment. -1 means
  // none, because index 0 is a real message.
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [copyNote, setCopyNote] = useState('');
  const [shareNote, setShareNote] = useState('');

  const messagesRef = useRef(null);
  const draftRef = useRef(null);
  const fileRef = useRef(null);
  const menuRef = useRef(null);
  const modelMenuRef = useRef(null);
  const abortRef = useRef(null);
  /*
   * Bumped whenever the open chat changes. A reply still arriving from the chat
   * the person just left checks this before painting anything, so a late delta
   * cannot land in somebody else's conversation.
   */
  const runRef = useRef(0);
  const atBottomRef = useRef(true);

  const loadConversations = useCallback(async (query = '') => {
    setListStatus('loading');
    try {
      setConversations(newestFirst(await fetchConversations(query, projectId)));
      setListError(null);
    } catch (error) {
      setListError(failureOf(error, 'Your saved chats could not be loaded.'));
    } finally {
      setListStatus('ready');
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConversations(conversationQuery);
    }, conversationQuery.trim() === '' ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [conversationQuery, loadConversations]);

  useEffect(() => {
    saveChatDraft(draft);
  }, [draft]);

  // A row menu closes on Escape or on a press anywhere else, which is what a menu
  // is expected to do. Without it the panel stayed open behind the next action.
  useEffect(() => {
    if (rowMenuId === null) return undefined;
    const closeOnPress = (event) => {
      if (event.target.closest?.('.chat-row-menu')) return;
      if (event.target.closest?.('[aria-expanded="true"]')) return;
      setRowMenuId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setRowMenuId(null);
    };
    document.addEventListener('pointerdown', closeOnPress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [rowMenuId]);

  /*
   * The same conversation can be moving on another device: the desktop app mirrors
   * its threads to this account and a second tab may be open. Nothing can be pushed
   * to a page, so it re-reads when it comes back into view and once a minute while it
   * is on screen. A reply already arriving is never interrupted.
   */
  const refreshHistory = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      setConversations(newestFirst(await fetchConversations(conversationQuery, projectId)));
      setListError(null);
    } catch {
      // A background refresh is a nicety: the list already on screen stays put, and
      // an error banner would report a failure nobody asked for.
    }
    if (!openId || streaming) return;
    const run = runRef.current;
    try {
      const data = await fetchConversation(openId);
      if (run !== runRef.current) return;
      const messages = chatMessages(data.messages);
      // Only a longer thread is taken: a shorter one means this tab holds turns the
      // account has not accepted yet, and dropping them would lose the person's text.
      setThread((previous) => (
        messages.length > previous.messages.length
          ? { title: data.title ?? previous.title, messages }
          : previous
      ));
    } catch {
      // Same reasoning as the list: what is open stays open.
    }
  }, [conversationQuery, openId, streaming, projectId]);

  useEffect(() => {
    const onVisible = () => {
      void refreshHistory();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [refreshHistory]);

  /**
   * Read the chosen file in the browser. Nothing is uploaded: the text is held in
   * memory and travels with the next message, the way the desktop app puts an
   * attached file in front of the question.
   */
  const chooseAttachment = useCallback(async (event) => {
    const file = event.target.files?.[0];
    // Cleared straight away so choosing the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;

    // A picture or a PDF goes to Cloudinary, so the browser never has to turn it
    // into text it cannot read and the account never stores the bytes.
    if (UPLOAD_TYPES.test(file.type)) {
      if (file.size > UPLOAD_MAX_BYTES) {
        setAttachNote('That file is over 10MB. Try a smaller one.');
        return;
      }
      setAttachNote('Uploading...');
      try {
        const signed = await signUpload();
        if (!signed.signature) {
          setAttachNote('Attachments are not switched on for this account yet. A text file still works.');
          return;
        }
        const uploaded = await uploadAttachment(file, signed);
        setAttachment({ ...uploaded, text: '', size: file.size });
        setAttachNote('');
      } catch (error) {
        // The message is the server's own wording where it gave one, so a size or
        // type refusal reads as an instruction rather than a generic failure.
        setAttachNote(error?.message || 'That file could not be uploaded. Try again.');
      }
      return;
    }

    if (!ATTACHMENT_TYPES.test(file.name)) {
      setAttachNote('The web chat can attach text files, pictures and PDFs. Anything else opens in the desktop app.');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setAttachNote('That text file is over 200 KB. Try a smaller one, or attach it in the desktop app.');
      return;
    }
    try {
      setAttachment({ name: file.name, size: file.size, text: await file.text() });
      setAttachNote('');
    } catch {
      setAttachNote('That file could not be read. Try choosing it again.');
    }
  }, []);

  const resetReply = useCallback(() => {
    setStreamReply('');
    setStreamError(null);
    setSaveWarning('');
  }, []);

  const openConversation = useCallback(
    async (id) => {
      runRef.current += 1;
      abortRef.current?.abort();
      setOpenId(id);
      setComposing(false);
      setThread({ title: '', messages: [] });
      setThreadStatus('loading');
      setThreadError(null);
      setRenamingId(null);
      setConfirmId(null);
      resetReply();
      atBottomRef.current = true;
      try {
        const data = await fetchConversation(id);
        setThread({ title: data.title ?? 'Untitled chat', messages: chatMessages(data.messages) });
        // A chat keeps the model it was started on, as the desktop transcript does, so
        // a thread begun on Zuri Pro opens on Zuri Pro instead of whatever this tab
        // last had selected. A code the picker does not offer is ignored.
        if (CHAT_MODELS.some((entry) => entry.code === data.model)) setModel(data.model);
        setThreadStatus('ready');
      } catch (error) {
        setThreadError(failureOf(error, 'This chat could not be opened.'));
        setThreadStatus('error');
      }
    },
    [resetReply],
  );

  const startNewChat = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    setOpenId(null);
    setComposing(true);
    setThread({ title: 'New chat', messages: [] });
    setThreadStatus('ready');
    setThreadError(null);
    setRenamingId(null);
    setConfirmId(null);
    setDraft('');
    clearChatDraft();
    resetReply();
    atBottomRef.current = true;
  }, [resetReply]);

  /*
   * Clicking anywhere else, or pressing Escape, closes the add menu. The menu holds
   * no form field, so a stray click behind it should dismiss it rather than leave a
   * panel open over the composer.
   */
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

  // The same dismissal for the model list: a click elsewhere or Escape closes it.
  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && modelMenuRef.current?.contains(event.target)) return;
      setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [modelMenuOpen]);

  // Every row closes the menu first, so a chosen item never leaves it hanging open.
  function pickMenuItem(action) {
    setMenuView('');
    action();
  }

  function insertCommand(text) {
    setDraft((current) => (current.trim() === '' ? text : `${current.trimEnd()}\n${text}`));
    draftRef.current?.focus();
  }

  const backToList = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    setOpenId(null);
    setComposing(false);
    setListOpen(true);
    setThread({ title: 'New chat', messages: [] });
    setThreadStatus('idle');
    setThreadError(null);
    setConfirmId(null);
    resetReply();
  }, [resetReply]);

  /**
   * Store a finished exchange. A brand new chat gets its conversation row here,
   * on the first send, so opening a chat and changing your mind saves nothing.
   */
  const saveExchange = useCallback(
    async (conversationId, question, answer, run, attachment = null) => {
      const title = titleFromQuestion(question);
      try {
        let id = conversationId;
        if (!id) {
          const created = await createConversation(title, model, projectId);
          id = typeof created?.id === 'string' ? created.id : '';
          if (!id) throw new Error('The new chat did not come back with an id.');
          if (run === runRef.current) {
            setOpenId(id);
            setComposing(false);
            setThread((previous) => ({ ...previous, title: created?.title ?? title }));
          }
        }
        await appendMessage(id, [
          { role: 'user', content: question, attachment },
          { role: 'assistant', content: answer },
        ]);
        if (run === runRef.current) loadConversations();
      } catch (error) {
        if (run !== runRef.current) return;
        // The messages stay on screen: losing the reply would be the worse
        // outcome, so a failed save is a warning and not an error.
        setSaveWarning(
          Number(error?.status) === 401
            ? 'Your session expired, so this chat may not be saved. Sign in again to keep your chats.'
            : 'This chat may not be saved. Check your connection and try again.',
        );
      }
    },
    [loadConversations, model, projectId],
  );

  const send = useCallback(async (questionOverride = null) => {
    const question = (typeof questionOverride === 'string' ? questionOverride : draft).trim();
    // Regenerating re-asks an earlier question, so only a fresh send carries the file.
    const attached = questionOverride === null ? attachment : null;
    if ((!question && !attached) || streaming) return;

    // What the model reads. A text file is quoted under a heading, the way the
    // desktop places an attachment in front of the prompt. A picture or a PDF has
    // no text to quote, so the model is told a file came with the turn and given
    // its link; it is never told it can see something it cannot.
    const labelled = attached ? attached.name : '';
    const withFile = attached
      ? (attached.text
        ? [`Attached file: ${labelled}`, attached.text].join('\n\n')
        : `A file came with this message: ${labelled} (${attached.kind}). Its contents are not readable here.`)
      : question;
    const withQuestion = attached && question !== '' ? `${question}\n\n${withFile}` : withFile;
    // The length the person picked rides with the question, the way the attachment
    // does. It is sent but not saved, so the transcript keeps only the words said.
    const prompt = withQuestion === '' ? question : `${withQuestion}\n\n${ANSWER_LENGTH_RULES[answerLength]}`;
    // What the bubble and the saved chat keep: the words, plus a line naming the
    // file. A link, where there is one, is stored beside the turn rather than
    // inside the words, so the thread draws a thumbnail instead of a long address.
    const said = attached
      ? (question === ''
        ? `[Attached file: ${labelled}]`
        : `${question}\n\n[Attached file: ${labelled}]`)
      : question;
    // Only an uploaded file becomes an attachment on the saved turn; a text file's
    // words are already in the message, so the account stores nothing extra.
    const storedAttachment = attached?.url
      ? { url: attached.url, name: attached.name, kind: attached.kind, bytes: attached.size ?? attached.bytes ?? 0 }
      : null;

    const run = (runRef.current += 1);
    const conversationId = openId;
    const outgoing = [...thread.messages, { role: 'user', content: said }]
      .slice(-HISTORY_LIMIT)
      .map(({ role, content }) => ({ role, content }));
    // The question the model answers is the last turn, so it carries the file.
    outgoing[outgoing.length - 1] = { role: 'user', content: prompt };

    setDraft('');
    setAttachment(null);
    setAttachNote('');
    clearChatDraft();
    resetReply();
    setStreaming(true);
    setThread((previous) => ({
      ...previous,
      messages: [...previous.messages, { role: 'user', content: said, attachment: storedAttachment }],
    }));
    atBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';

    try {
      const result = await streamChat({
        messages: outgoing,
        model,
        // A chat inside a project names it, so the server adds that project's
        // instructions and files to the prompt before the question is sent.
        projectId,
        signal: controller.signal,
        onDelta: (text) => {
          if (run !== runRef.current) return;
          reply += text;
          setStreamReply(reply);
        },
      });
      if (run !== runRef.current) return;
      const answer = result?.content || reply;
      if (!answer) {
        // On screen but not saved: an empty exchange is not worth a conversation row.
        setStreamError({ message: 'No reply arrived. Send that again when the connection is back.', status: 0 });
        setStreamReply('');
        return;
      }
      setThread((previous) => ({
        ...previous,
        messages: [...previous.messages, { role: 'assistant', content: answer }],
      }));
      setStreamReply('');
      await saveExchange(conversationId, said, answer, run, storedAttachment);
    } catch (error) {
      if (run !== runRef.current) return;
      // Stop, or a dropped connection, keeps what already arrived on screen: it
      // is readable, and the person can see where the reply stopped.
      if (reply) {
        setThread((previous) => ({
          ...previous,
          messages: [...previous.messages, { role: 'assistant', content: reply }],
        }));
      }
      setStreamReply('');
      if (error?.name !== 'AbortError') setStreamError(failureOf(error, 'The reply could not be completed.'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  }, [draft, streaming, openId, thread.messages, model, resetReply, saveExchange, projectId]);

  const editMessage = useCallback((message) => {
    const content = typeof message?.content === 'string' ? message.content : '';
    if (content.trim() === '' || streaming) return;
    setDraft(content);
    window.requestAnimationFrame(() => draftRef.current?.focus());
  }, [streaming]);

  const regenerateReply = useCallback(() => {
    if (streaming) return;
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index];
      if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim() !== '') {
        void send(message.content);
        return;
      }
    }
  }, [send, streaming, thread.messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const saveRename = useCallback(
    async (id) => {
      const title = renameDraft.trim();
      if (!title) return;
      try {
        const updated = await renameConversation(id, title);
        const next = updated?.title ?? title;
        setConversations((previous) => previous.map((item) => (item.id === id ? { ...item, title: next } : item)));
        if (openId === id) setThread((previous) => ({ ...previous, title: next }));
        setRenamingId(null);
        setRenameDraft('');
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be renamed.'));
      }
    },
    [renameDraft, openId],
  );

  const removeConversation = useCallback(
    async (id) => {
      try {
        await deleteConversation(id);
        setConversations((previous) => previous.filter((item) => item.id !== id));
        setConfirmId(null);
        if (openId === id) backToList();
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be deleted.'));
      }
    },
    [openId, backToList],
  );


  /**
   * Open the project list in a row's menu, reading it the first time.
   *
   * The list is fetched on demand rather than on mount: most visits to the chat
   * never move a chat, and a person with no projects should not pay a request for
   * every page load.
   */
  const openProjectPicker = useCallback(async (conversationId) => {
    setConfirmId(null);
    setProjectPickerFor(conversationId);
    if (projects.length > 0 || projectsStatus === 'loaded') return;
    setProjectsStatus('loading');
    try {
      const list = await fetchProjects();
      setProjects(list);
      setProjectsStatus('loaded');
    } catch (error) {
      setProjectsStatus('failed');
      setListError(failureOf(error, 'Your projects could not be loaded.'));
    }
  }, [projects.length, projectsStatus]);

  /**
   * File one chat into a project, or take it out with null.
   *
   * Inside a project the list is that project's own, so a chat moved somewhere else
   * has to leave it, exactly as an archived chat does. Filed from the whole history,
   * the row simply records where it now belongs.
   */
  const fileConversation = useCallback(
    async (conversation, targetProjectId) => {
      setFilingId(conversation.id);
      try {
        const updated = await setConversationProject(conversation.id, targetProjectId);
        setConversations((previous) => {
          const moved = previous.map((item) => (item.id === conversation.id ? { ...item, ...updated } : item));
          const nowInThisProject = String(updated?.projectId ?? '') === String(projectId ?? '');
          return nowInThisProject ? moved : moved.filter((item) => item.id !== conversation.id);
        });
        if (String(updated?.projectId ?? '') !== String(projectId ?? '') && openId === conversation.id) backToList();
        setProjectPickerFor(null);
        setRowMenuId(null);
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be moved into a project.'));
      } finally {
        setFilingId('');
      }
    },
    [backToList, openId, projectId],
  );

  /**
   * Move a chat in the list, the way ChatGPT's row menu does.
   *
   * Pinning and archiving are one call because they answer the same question,
   * where the chat belongs. The row is updated in place from the server's answer
   * rather than refetched, so the list does not flicker while it moves.
   */
  const moveConversation = useCallback(
    async (conversation, flags) => {
      try {
        const updated = await setConversationFlags(conversation.id, flags);
        setConversations((previous) => previous.map((item) => (item.id === conversation.id ? { ...item, ...updated } : item)));
        // A filed chat leaves the list, and the thread it was showing goes with it.
        if (flags.archived === true) {
          setConversations((previous) => previous.filter((item) => item.id !== conversation.id));
          if (openId === conversation.id) backToList();
        }
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be moved.'));
      }
    },
    [openId, backToList],
  );
  const scrollToEnd = useCallback(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  const onMessagesScroll = useCallback(() => {
    const node = messagesRef.current;
    if (!node) return;
    // Reading further up is not interrupted: a new delta only follows the view
    // while the newest message is already in sight.
    atBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }, []);

  /**
   * Copy one message, the same affordance the desktop transcript has on both a
   * prompt and a reply. The confirmation clears itself, so the button returns to
   * "Copy" without a second click.
   * @param {{ role: string, content: string }} message
   * @param {number} index
   */
  const copyMessage = useCallback(async (message, index) => {
    const copied = await copyText(String(message?.content ?? ''));
    if (!copied) {
      setCopyNote('That message could not be copied to the clipboard.');
      return;
    }
    setCopyNote('');
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex((current) => (current === index ? -1 : current)), 1500);
  }, []);

  const shareMessage = useCallback(async (message) => {
    const content = String(message?.content ?? '').trim();
    if (!content) return;
    const result = await shareText({
      title: message?.role === 'assistant' ? "Zuri's reply" : 'My message',
      text: content,
    });
    if (result === 'shared') {
      setShareNote('');
      return;
    }
    const copied = await copyText(content);
    setShareNote(copied ? 'Sharing is not available here, so the message was copied.' : 'This message could not be shared.');
  }, []);

  const showThread = Boolean(openId || composing);
  // Which pane a phone shows. An open chat always wins, so picking a conversation
  // puts it in front without clearing the list flag first.
  const pane = showThread || !listOpen ? 'thread' : 'list';
  const closeList = () => setListOpen(false);

  useEffect(() => {
    if (atBottomRef.current) scrollToEnd();
  }, [thread.messages, streamReply, threadStatus, scrollToEnd]);

  // Opening a chat puts the caret where the next action is.
  useEffect(() => {
    if (showThread) draftRef.current?.focus();
  }, [showThread, openId]);

  /*
   * The composer grows with the draft rather than scrolling inside a one-line box.
   * Its scrollbar is hidden, so without this a long message would scroll out of
   * sight instead of being readable. The desktop composer grows the same way and
   * caps at 192px; this one stops a little sooner because a phone has less height
   * to give the transcript.
   */
  useEffect(() => {
    const node = draftRef.current;
    if (!node) return;

    const fit = () => {
      // An empty draft needs no measurement: dropping the inline height hands the
      // field back to its one-line floor, so clearing a long draft returns the
      // composer to exactly the height it opened at.
      if (node.value === '') {
        node.style.height = '';
        return;
      }

      // The one-line floor is lifted for the measurement: with it in place the box
      // cannot resolve to its content height, and scrollHeight would report the
      // floor instead of the text, leaving the field a line too tall.
      const floor = node.style.minHeight;
      node.style.minHeight = '0';
      node.style.height = 'auto';
      // scrollHeight covers the text only, and the site draws controls border-box, so
      // the field's own padding has to be added or a one-line box clips its text.
      const style = window.getComputedStyle(node);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const measured = node.scrollHeight + padding;
      node.style.minHeight = floor;
      node.style.height = `${Math.min(measured, 160)}px`;
    };

    // Measured after layout: a box that has just mounted reports no content height,
    // which would leave the field one line short of its own placeholder.
    const frame = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(frame);
    // showThread is a dependency because the field is not on screen until it is true.
  }, [draft, showThread]);

  const onComposerKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An IME pick can arrive as Enter; that is text, not a send.
    if (event.nativeEvent?.isComposing) return;
    event.preventDefault();
    send();
  };

  const sessionExpired = listError?.status === 401 || threadError?.status === 401 || streamError?.status === 401;
  const modelName = modelNameFor(model);
  // The phone row is short, so the label drops its "Zuri" prefix there rather than
  // disappearing: an unlabelled chevron does not say which model will answer.
  const modelShortName = modelName.replace(/^Zuri\s+/, '');
  // The newest reply carries the caption, as the desktop transcript does: repeating
  // the model above every bubble would say the same thing down the whole page.
  const lastAnswerIndex = thread.messages.reduce((last, message, index) => (message.role === 'assistant' ? index : last), -1);

  return (
    <section className="chat-workspace" data-pane={pane}>
      {/*
        * The saved chats, drawn the way the desktop app's chat sidebar draws them:
        * a Recents label, then one quiet row per thread. Starting a chat is the Chat
        * destination's own job, so the column carries no second button for it. On a
        * phone this pane slides over the thread, which is how ChatGPT treats the
        * same list, and the thread keeps its own back control.
        */}
      <aside className={`chat-recents${navCollapsed ? ' is-collapsed' : ''}`} aria-label="Saved chats">
        {/* On a phone this column covers the chat, so it carries the way back to it.
            The shared navigation panel's own close control is hidden here in CSS,
            because this one closes the list rather than the drawer. */}
        <div className="chat-list-head">
          <IconButton label="Close saved chats" onClick={closeList}>
            <CloseIcon size={18} aria-hidden="true" />
          </IconButton>
        </div>
        {/* The same navigation panel the other pages show, so a chat has one sidebar
            holding both the destinations and the conversations. */}
        {navigation && <div className="chat-nav">{navigation}</div>}

        {/* Inside a project the list is that project's own, so it says which one and
            offers the way back to the projects screen. Without this a person could not
            tell the project history from the whole history. */}
        {projectId !== '' && (
          <div className="chat-project">
            <span className="chat-project-name">
              <FolderIcon size={16} aria-hidden="true" />
              {projectName === '' ? 'This project' : projectName}
            </span>
            {onLeaveProject && (
              <Button variant="ghost" className="chat-project-leave" onClick={onLeaveProject}>
                All chats
              </Button>
            )}
          </div>
        )}

        <ConversationSearch
          value={conversationQuery}
          onChange={setConversationQuery}
          onClear={() => setConversationQuery('')}
        />

        <div className="chat-recents-list">
          {listStatus === 'loading' && <p className="chat-recents-empty">Loading your chats...</p>}
          {listStatus !== 'loading' && conversations.length === 0 && (
            <p className="chat-recents-empty">
              {conversationQuery.trim() === ''
                ? 'No saved chats yet. Your first question appears here.'
                : 'No chats match that search.'}
            </p>
          )}

          {withGroupHeadings(conversations, conversationQuery.trim() !== '').map(({ conversation, heading }) => (
            <div key={conversation.id} data-group={heading || undefined} className={`chat-recent${conversation.id === openId ? ' is-active' : ''}`}>
              {renamingId === conversation.id ? (
                <form
                  className="chat-recent-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename(conversation.id);
                  }}
                >
                  <input
                    className="chat-recent-input"
                    aria-label="Chat name"
                    maxLength={120}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    autoFocus
                  />
                  <IconButton type="submit" size="sm" label="Save name" disabled={renameDraft.trim() === ''}>
                    <CheckIcon size={14} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Cancel renaming"
                    onClick={() => { setRenamingId(null); setRenameDraft(''); }}
                  >
                    <CloseIcon size={14} aria-hidden="true" />
                  </IconButton>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="chat-recent-open"
                    onClick={() => void openConversation(conversation.id)}
                    aria-current={conversation.id === openId ? 'page' : undefined}
                    title={conversation.title || 'New chat'}
                  >
                    <span className="chat-recent-title">
                      {conversation.pinned && <PinIcon size={12} filled aria-hidden="true" />}
                      {conversation.title || 'New chat'}
                    </span>
                    <span className="chat-recent-meta">{formatRelativeTime(stamp(conversation) || undefined)}</span>
                  </button>
                  <span className="chat-recent-actions">
                    {/*
                      * One control per row, as ChatGPT draws it: the actions appear in a
                      * menu rather than sitting on the row. Four icons beside a title
                      * left no room for the title itself, and a row is read far more
                      * often than it is acted on.
                      */}
                    <IconButton
                      size="sm"
                      label={`Actions for ${conversation.title || 'chat'}`}
                      aria-expanded={rowMenuId === conversation.id}
                      onClick={() => { setRowMenuId(rowMenuId === conversation.id ? null : conversation.id); setConfirmId(null); }}
                    >
                      <MoreIcon size={14} aria-hidden="true" />
                    </IconButton>
                    {rowMenuId === conversation.id && projectPickerFor === conversation.id && (
                      <div className="chat-row-menu chat-row-menu-projects" role="menu" aria-label="Move this chat to a project">
                        <MenuBack
                          onBack={() => {
                            setProjectPickerFor(null);
                            setRowMenuId(null);
                          }}
                        >
                          Move to project
                        </MenuBack>
                        {projectsStatus === 'loading' && <p className="chat-menu-note">Reading your projects...</p>}
                        {filingId === conversation.id && <p className="chat-menu-note">Moving this chat...</p>}
                        {projectsStatus === 'failed' && <p className="chat-menu-note">Your projects could not be loaded.</p>}
                        {projectsStatus === 'loaded' && projects.length === 0 && (
                          <p className="chat-menu-note">No projects yet. Make one on the Projects page.</p>
                        )}
                        {projects.map((project) => (
                          <MenuItem
                            key={project.id}
                            role="menuitemradio"
                            checked={String(conversation.projectId ?? '') === String(project.id)}
                            onSelect={() => void fileConversation(conversation, project.id)}
                          >
                            <FolderIcon size={14} aria-hidden="true" />
                            <span className="chat-menu-label">{project.name || 'Untitled project'}</span>
                            {String(conversation.projectId ?? '') === String(project.id) && <CheckIcon size={14} aria-hidden="true" />}
                          </MenuItem>
                        ))}
                        {String(conversation.projectId ?? '') !== '' && (
                          <MenuItem
                            role="menuitemradio"
                            checked={false}
                            onSelect={() => void fileConversation(conversation, null)}
                          >
                            <CloseIcon size={14} aria-hidden="true" />
                            Take out of its project
                          </MenuItem>
                        )}
                      </div>
                    )}
                    {rowMenuId === conversation.id && projectPickerFor !== conversation.id && (
                      <div className="chat-row-menu" role="menu">
                        <MenuItem onSelect={() => { setRowMenuId(null); setRenamingId(conversation.id); setRenameDraft(conversation.title ?? ''); }}>
                          <EditIcon size={14} aria-hidden="true" />
                          Rename
                        </MenuItem>
                        <MenuItem onSelect={() => void openProjectPicker(conversation.id)}>
                          <FolderIcon size={14} aria-hidden="true" />
                          {conversation.projectId ? 'Move to another project' : 'Move to project'}
                        </MenuItem>
                        <MenuItem onSelect={() => { setRowMenuId(null); void moveConversation(conversation, { pinned: !conversation.pinned }); }}>
                          <PinIcon size={14} filled={conversation.pinned === true} aria-hidden="true" />
                          {conversation.pinned ? 'Unpin' : 'Pin to top'}
                        </MenuItem>
                        <MenuItem onSelect={() => { setRowMenuId(null); void moveConversation(conversation, { archived: true }); }}>
                          <ArchiveIcon size={14} aria-hidden="true" />
                          Archive
                        </MenuItem>
                        <MenuItem
                          className={confirmId === conversation.id ? 'is-danger' : ''}
                          onSelect={() => {
                            // Deleting takes two choices: the first arms the item, the
                            // second removes the chat, so one stray press cannot lose one.
                            if (confirmId === conversation.id) { setRowMenuId(null); void removeConversation(conversation.id); }
                            else setConfirmId(conversation.id);
                          }}
                        >
                          <DeleteIcon size={14} aria-hidden="true" />
                          {confirmId === conversation.id ? 'Confirm delete' : 'Delete'}
                        </MenuItem>
                      </div>
                    )}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        <p className="chat-recents-foot">Every chat here is saved to your account.</p>
      </aside>

      <main className="chat-thread">
        {/*
          * Two bare floating icons, as the desktop chat draws them, rather than a
          * header bar: the chat list on the left (or the back control on a phone) and
          * starting a new chat on the right. The transcript scrolls underneath them.
          */}
        <div className="chat-floats">
          {/* A phone can hold only one pane, so this corner always carries the way
              back to the list, even from the opening state with nothing open. A wide
              screen keeps the list beside the thread and hides the button in CSS. */}
          <IconButton
            label={showThread ? 'Back to saved chats' : 'Open saved chats'}
            className="chat-back"
            onClick={backToList}
          >
            <ChevronLeftIcon size={18} aria-hidden="true" />
          </IconButton>
          <div className="chat-floats-end">
            <IconButton label="New chat" onClick={startNewChat}>
              <PlusIcon size={18} aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div ref={messagesRef} onScroll={onMessagesScroll} className="chat-transcript">
          {!showThread && (
            <div className="chat-opening">
              <span className="chat-opening-mark" aria-hidden="true">
                <LogoMark size={30} />
              </span>
              <h2>{greetingFor(userName)}</h2>
              <p>Ask anything below to begin. A reply can carry code, a table or a list of links, and the chat is saved to your account.</p>
            </div>
          )}

          {showThread && threadStatus === 'loading' && <p className="chat-empty">Loading messages...</p>}

          {showThread && threadStatus !== 'loading' && thread.messages.length === 0 && !streaming && (
            <div className="chat-opening">
              <span className="chat-opening-mark" aria-hidden="true">
                <LogoMark size={30} />
              </span>
              <h2>{greetingFor(userName)}</h2>
              <p>
                {openId
                  ? 'This chat has no messages yet. Ask something below and the exchange is saved here.'
                  : 'Ask anything below. This chat is saved to your account once you send, so it opens on any device.'}
              </p>
            </div>
          )}

          {thread.messages.map((message, index) => (
            <Fragment key={`${index}-${message.role}`}>
              {/* The desktop prints the model above the reply, outside the bubble. */}
              {message.role === 'assistant' && index === lastAnswerIndex && (
                <span className="chat-bubble-role">{modelName}</span>
              )}
              <article className={`chat-bubble chat-bubble-${message.role}`}>
                {/* A prompt is shown exactly as typed. A reply goes through the desktop's
                    own renderer, so code, lists, tables and links read the same on both. */}
                {message.attachment && (
                  // The file came from this account's own Cloudinary folder, so the
                  // link is a CDN address rather than anything the server serves.
                  // A picture is drawn small enough to keep the thread readable; a
                  // PDF is a named row, because a page thumbnail would be another
                  // transformation to pay for.
                  message.attachment.kind?.startsWith('image/') ? (
                    <a className="chat-attachment" href={message.attachment.url} target="_blank" rel="noopener noreferrer">
                      <img src={message.attachment.url} alt={message.attachment.name} loading="lazy" decoding="async" />
                      <span>{message.attachment.name}</span>
                    </a>
                  ) : (
                    <a className="chat-attachment is-file" href={message.attachment.url} target="_blank" rel="noopener noreferrer">
                      <FileIcon size={ICON_SIZE.lg} />
                      <span>{message.attachment.name}</span>
                    </a>
                  )
                )}
                {message.role === 'assistant'
                  ? <div className="chat-answer"><FormattedMessage content={message.content} /></div>
                  : <p className="chat-text">{message.content}</p>}
                <div className="chat-bubble-actions">
                  {message.role === 'user' && (
                    <IconButton
                      size="sm"
                      className="chat-edit"
                      label="Edit and send again"
                      onClick={() => editMessage(message)}
                    >
                      <EditIcon size={14} aria-hidden="true" />
                    </IconButton>
                  )}
                  {message.role === 'assistant' && index === lastAnswerIndex && (
                    <IconButton
                      size="sm"
                      className="chat-regenerate"
                      label="Regenerate reply"
                      onClick={regenerateReply}
                    >
                      <RegenerateIcon size={14} aria-hidden="true" />
                    </IconButton>
                  )}
                  <IconButton
                    size="sm"
                    className="chat-copy"
                    label={copiedIndex === index ? 'Copied' : message.role === 'user' ? 'Copy your message' : "Copy Zuri's reply"}
                    onClick={() => void copyMessage(message, index)}
                  >
                    {copiedIndex === index ? <CheckIcon size={14} aria-hidden="true" /> : <CopyIcon size={14} aria-hidden="true" />}
                  </IconButton>
                  <IconButton
                    size="sm"
                    className="chat-share"
                    label="Share message"
                    onClick={() => void shareMessage(message)}
                  >
                    <ShareIcon size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              </article>
            </Fragment>
          ))}

          {streaming && (
            <article className="chat-bubble chat-bubble-assistant is-streaming">
              {streamReply
                ? <div className="chat-answer"><FormattedMessage content={streamReply} /></div>
                : <p className="chat-text">Zuri is thinking...</p>}
            </article>
          )}
        </div>

        <div className="chat-composer-wrap">
          {sessionExpired && (
            <InlineAlert tone="danger">
              Your session expired. Sign in again to reach your saved chats.
              {onSignIn && (
                <Button variant="secondary" className="chat-alert-action" onClick={onSignIn}>
                  Sign in
                </Button>
              )}
            </InlineAlert>
          )}
          {listError && !sessionExpired && <InlineAlert tone="danger">{listError.message}</InlineAlert>}
          {threadError && !sessionExpired && <InlineAlert tone="danger">{threadError.message}</InlineAlert>}
          {streamError && <InlineAlert tone="danger">{streamError.message}</InlineAlert>}
          {saveWarning !== '' && <p className="chat-note">{saveWarning}</p>}
          {copyNote !== '' && <p className="chat-note is-error">{copyNote}</p>}
          {shareNote !== '' && <p className="chat-note">{shareNote}</p>}
          {attachNote !== '' && <p className="chat-note is-error">{attachNote}</p>}
          {attachment && (
            <div className="chat-attachment">
              <PaperclipIcon size={14} aria-hidden="true" />
              <span className="chat-attachment-name" title={attachment.name}>{attachment.name}</span>
              <span className="chat-attachment-meta">
                {/* Said plainly: the text is sent with the message and the file
                    itself is never uploaded. */}
                sent with this message
              </span>
              <IconButton
                size="sm"
                label="Remove attached file"
                onClick={() => { setAttachment(null); setAttachNote(''); }}
              >
                <CloseIcon size={14} aria-hidden="true" />
              </IconButton>
            </div>
          )}

          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {/* The desktop composer leads with an add control, so the web one does too.
                It carries only what a browser and this server can actually do: a file
                a page can read, a reply length, and the starter sentences. Adding a
                folder, searching the web and drawing a picture are desktop only
                because they need the desktop app or a route the cloud API does not
                have, and a menu item that cannot work is worse than no item. */}
            <div ref={menuRef} className="relative">
              <IconButton
                className="chat-attach"
                label="Add to message"
                title="Add a file, a reply length or a command"
                aria-haspopup="menu"
                aria-expanded={menuView !== ''}
                onClick={() => setMenuView((current) => (current === '' ? 'main' : ''))}
              >
                <PlusIcon size={18} aria-hidden="true" />
              </IconButton>
              {menuView !== '' && (
                <div
                  role="menu"
                  aria-label="Add to message"
                  className="chat-menu"
                >
                  {menuView === 'main' ? (
                    <>
                      <MenuItem onSelect={() => pickMenuItem(() => fileRef.current?.click())}>
                        <PaperclipIcon size={16} aria-hidden="true" />
                        <span>Attach a file</span>
                      </MenuItem>
                      <MenuItem onSelect={() => setMenuView('length')}>
                        <AlignLeftIcon size={16} aria-hidden="true" />
                        <span className="flex-1">Reply length</span>
                        <span className="text-xs capitalize text-[var(--muted)]">{answerLength}</span>
                      </MenuItem>
                      <MenuItem onSelect={() => setMenuView('commands')}>
                        <CommandIcon size={16} aria-hidden="true" />
                        <span>Slash commands</span>
                      </MenuItem>
                    </>
                  ) : menuView === 'length' ? (
                    <>
                      <MenuBack onBack={() => setMenuView('main')}>Reply length</MenuBack>
                      {ANSWER_LENGTH_CHOICES.map(([value, label, hint]) => (
                        <MenuItem
                          key={value}
                          role="menuitemradio"
                          checked={answerLength === value}
                          onSelect={() => pickMenuItem(() => setAnswerLength(value))}
                        >
                          <span className="flex-1">{label}</span>
                          <span className="text-xs text-[var(--muted)]">{hint}</span>
                          {answerLength === value && <CheckIcon size={16} aria-hidden="true" />}
                        </MenuItem>
                      ))}
                    </>
                  ) : (
                    <>
                      <MenuBack onBack={() => setMenuView('main')}>Slash commands</MenuBack>
                      {SLASH_COMMANDS.map((command) => (
                        <MenuItem key={command.label} onSelect={() => pickMenuItem(() => insertCommand(command.text))}>
                          <span>{command.label}</span>
                        </MenuItem>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              className="chat-file-input"
              aria-label="Attach a file"
              accept=".txt,.text,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sql,.xml,image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(event) => void chooseAttachment(event)}
            />
            <Textarea
              ref={draftRef}
              className="chat-input"
              rows={1}
              value={draft}
              placeholder="Ask Zuri anything"
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
            />

            {/* The model chip sits beside Send, exactly as the desktop composer places
                it, and names the model that will answer this chat. */}
            <div ref={modelMenuRef} className="chat-model-slot">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                aria-label={`Model: ${modelName}`}
                title="Choose the model that answers"
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span className="chat-model-label">
                  <span className="chat-model-label-full">{modelName}</span>
                  <span className="chat-model-label-short">{modelShortName}</span>
                </span>
                <ChevronUpIcon
                  size={16}
                  aria-hidden="true"
                  className={`chat-model-chevron${modelMenuOpen ? ' is-open' : ''}`}
                />
              </button>
              {modelMenuOpen && (
                <div role="menu" aria-label="Choose a model" className="chat-model-menu">
                  {CHAT_MODELS.map((entry) => (
                    <MenuItem
                      key={entry.code}
                      role="menuitemradio"
                      checked={model === entry.code}
                      onSelect={() => {
                        setModel(entry.code);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span className="chat-model-name">{entry.name}</span>
                      {model === entry.code && <CheckIcon size={14} aria-hidden="true" />}
                    </MenuItem>
                  ))}
                </div>
              )}
            </div>

            {streaming ? (
              <IconButton label="Stop reply" className="chat-send" onClick={stop}>
                <StopIcon size={14} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton type="submit" label="Send" className="chat-send" disabled={draft.trim() === '' && !attachment}>
                <SendIcon size={18} aria-hidden="true" />
              </IconButton>
            )}
          </form>
        </div>
      </main>
    </section>
  );
}
