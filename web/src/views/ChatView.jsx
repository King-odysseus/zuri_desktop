import { useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, DropdownItem, Textarea } from 'flowbite-react';
import {
  ArrowUp,
  Check,
  ChevronLeft,
  Copy,
  Pencil,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { Button, InlineAlert } from '../components/ui.jsx';
import { LogoMark } from '../components/Icons.jsx';
// The reply renderer and the clipboard fallback are the desktop app's own modules,
// imported rather than copied: an answer is then drawn by one set of markdown rules
// on both surfaces, and the code block's own copy button behaves the same way.
import FormattedMessage from '../../../src/renderer-react/FormattedMessage.jsx';
import { copyText } from '../../../src/renderer-react/clipboard.js';
import {
  DEFAULT_CHAT_MODEL,
  appendMessage,
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  renameConversation,
  streamChat,
} from '../lib/api.js';
import { formatRelativeTime, greetingFor } from '../lib/format.js';

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
export default function ChatView({ onSignIn, userName = '' }) {
  const [conversations, setConversations] = useState([]);
  const [listStatus, setListStatus] = useState('loading');
  const [listError, setListError] = useState(null);

  const [openId, setOpenId] = useState(null);
  // A new chat has no conversation row yet: it is created on the first send.
  const [composing, setComposing] = useState(false);
  const [thread, setThread] = useState({ title: 'New chat', messages: [] });
  const [threadStatus, setThreadStatus] = useState('idle');
  const [threadError, setThreadError] = useState(null);

  const [draft, setDraft] = useState('');
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [streaming, setStreaming] = useState(false);
  const [streamReply, setStreamReply] = useState('');
  const [streamError, setStreamError] = useState(null);
  const [saveWarning, setSaveWarning] = useState('');

  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  // Which bubble was just copied, so its button can say so for a moment. -1 means
  // none, because index 0 is a real message.
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [copyNote, setCopyNote] = useState('');

  const messagesRef = useRef(null);
  const draftRef = useRef(null);
  const abortRef = useRef(null);
  /*
   * Bumped whenever the open chat changes. A reply still arriving from the chat
   * the person just left checks this before painting anything, so a late delta
   * cannot land in somebody else's conversation.
   */
  const runRef = useRef(0);
  const atBottomRef = useRef(true);

  const loadConversations = useCallback(async () => {
    setListStatus('loading');
    try {
      setConversations(newestFirst(await fetchConversations()));
      setListError(null);
    } catch (error) {
      setListError(failureOf(error, 'Your saved chats could not be loaded.'));
    } finally {
      setListStatus('ready');
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  /*
   * The same conversation can be moving on another device: the desktop app mirrors
   * its threads to this account and a second tab may be open. Nothing can be pushed
   * to a page, so it re-reads when it comes back into view and once a minute while it
   * is on screen. A reply already arriving is never interrupted.
   */
  const refreshHistory = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      setConversations(newestFirst(await fetchConversations()));
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
  }, [openId, streaming]);

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
    resetReply();
    atBottomRef.current = true;
  }, [resetReply]);

  const backToList = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    setOpenId(null);
    setComposing(false);
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
    async (conversationId, question, answer, run) => {
      const title = titleFromQuestion(question);
      try {
        let id = conversationId;
        if (!id) {
          const created = await createConversation(title, model);
          id = typeof created?.id === 'string' ? created.id : '';
          if (!id) throw new Error('The new chat did not come back with an id.');
          if (run === runRef.current) {
            setOpenId(id);
            setComposing(false);
            setThread((previous) => ({ ...previous, title: created?.title ?? title }));
          }
        }
        await appendMessage(id, [
          { role: 'user', content: question },
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
    [loadConversations, model],
  );

  const send = useCallback(async () => {
    const question = draft.trim();
    if (!question || streaming) return;

    const run = (runRef.current += 1);
    const conversationId = openId;
    const outgoing = [...thread.messages, { role: 'user', content: question }]
      .slice(-HISTORY_LIMIT)
      .map(({ role, content }) => ({ role, content }));

    setDraft('');
    resetReply();
    setStreaming(true);
    setThread((previous) => ({
      ...previous,
      messages: [...previous.messages, { role: 'user', content: question }],
    }));
    atBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';

    try {
      const result = await streamChat({
        messages: outgoing,
        model,
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
      await saveExchange(conversationId, question, answer, run);
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
  }, [draft, streaming, openId, thread.messages, model, resetReply, saveExchange]);

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

  const showThread = Boolean(openId || composing);

  useEffect(() => {
    if (atBottomRef.current) scrollToEnd();
  }, [thread.messages, streamReply, threadStatus, scrollToEnd]);

  // Opening a chat puts the caret where the next action is.
  useEffect(() => {
    if (showThread) draftRef.current?.focus();
  }, [showThread, openId]);

  const onComposerKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An IME pick can arrive as Enter; that is text, not a send.
    if (event.nativeEvent?.isComposing) return;
    event.preventDefault();
    send();
  };

  const sessionExpired = listError?.status === 401 || threadError?.status === 401 || streamError?.status === 401;
  const title = thread.title || 'New chat';
  const modelName = modelNameFor(model);
  // The newest reply carries the caption, as the desktop transcript does: repeating
  // the model above every bubble would say the same thing down the whole page.
  const lastAnswerIndex = thread.messages.reduce((last, message, index) => (message.role === 'assistant' ? index : last), -1);

  return (
    <section className="chat-workspace" data-pane={showThread ? 'thread' : 'list'}>
      {/*
        * The saved chats, drawn the way the desktop app's chat sidebar draws them:
        * a New chat row, a Recents label, then one quiet row per thread. On a phone
        * this pane slides over the thread, which is how ChatGPT treats the same list,
        * and the thread keeps its own back control.
        */}
      <aside className="chat-recents" aria-label="Saved chats">
        <div className="chat-recents-head">
          <Button variant="secondary" block className="chat-new" onClick={startNewChat}>
            <Plus size={16} aria-hidden="true" />
            <span>New chat</span>
          </Button>
        </div>

        <p className="chat-recents-label">Recents</p>

        <div className="chat-recents-list">
          {listStatus === 'loading' && <p className="chat-recents-empty">Loading your chats...</p>}
          {listStatus !== 'loading' && conversations.length === 0 && (
            <p className="chat-recents-empty">No saved chats yet. Your first question appears here.</p>
          )}

          {conversations.map((conversation) => (
            <div key={conversation.id} className={`chat-recent${conversation.id === openId ? ' is-active' : ''}`}>
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
                  <button type="submit" className="chat-row-action" aria-label="Save name" disabled={renameDraft.trim() === ''}>
                    <Check size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="chat-row-action"
                    aria-label="Cancel renaming"
                    onClick={() => { setRenamingId(null); setRenameDraft(''); }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
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
                    <span className="chat-recent-title">{conversation.title || 'New chat'}</span>
                    <span className="chat-recent-meta">{formatRelativeTime(stamp(conversation) || undefined)}</span>
                  </button>
                  <span className="chat-recent-actions">
                    <button
                      type="button"
                      className="chat-row-action"
                      aria-label={`Rename ${conversation.title || 'chat'}`}
                      onClick={() => { setRenamingId(conversation.id); setRenameDraft(conversation.title ?? ''); }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`chat-row-action${confirmId === conversation.id ? ' is-danger' : ''}`}
                      aria-label={confirmId === conversation.id
                        ? `Confirm deleting ${conversation.title || 'chat'}`
                        : `Delete ${conversation.title || 'chat'}`}
                      onClick={() => {
                        // Deleting takes two clicks: the first arms the row, the second
                        // removes it, so a stray tap cannot lose a conversation.
                        if (confirmId === conversation.id) void removeConversation(conversation.id);
                        else setConfirmId(conversation.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        <p className="chat-recents-foot">Every chat here is saved to your account.</p>
      </aside>

      <main className="chat-thread">
        <header className="chat-thread-head">
          <button type="button" className="chat-icon-btn chat-back" aria-label="Back to saved chats" onClick={backToList}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div className="chat-thread-title">
            <h1>{title}</h1>
            <p>{streaming ? 'Zuri is answering...' : 'Saved to your account'}</p>
          </div>
        </header>

        <div ref={messagesRef} onScroll={onMessagesScroll} className="chat-transcript">
          {!showThread && (
            <div className="chat-opening">
              <span className="chat-opening-mark" aria-hidden="true">
                <LogoMark size={30} />
              </span>
              <h2>{greetingFor(userName)}</h2>
              <p>Pick a chat from the list, or ask something new. A reply can carry code, a table or a list of links.</p>
              <Button variant="secondary" onClick={startNewChat}>
                <Plus size={16} aria-hidden="true" />
                <span>Start a new chat</span>
              </Button>
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
            <article key={`${index}-${message.role}`} className={`chat-bubble chat-bubble-${message.role}`}>
              {message.role === 'assistant' && index === lastAnswerIndex && (
                <span className="chat-bubble-role">{modelName}</span>
              )}
              {/* A prompt is shown exactly as typed. A reply goes through the desktop's
                  own renderer, so code, lists, tables and links read the same on both. */}
              {message.role === 'assistant'
                ? <div className="chat-answer"><FormattedMessage content={message.content} /></div>
                : <p className="chat-text">{message.content}</p>}
              <div className="chat-bubble-actions">
                <button
                  type="button"
                  className="chat-copy"
                  aria-label={copiedIndex === index ? 'Copied' : message.role === 'user' ? 'Copy your message' : "Copy Zuri's reply"}
                  title={copiedIndex === index ? 'Copied' : 'Copy'}
                  onClick={() => void copyMessage(message, index)}
                >
                  {copiedIndex === index ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </button>
              </div>
            </article>
          ))}

          {streaming && (
            <article className="chat-bubble chat-bubble-assistant is-streaming">
              <span className="chat-bubble-role">{modelName}</span>
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

          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
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
            <div className="chat-model-slot">
              <Dropdown label={modelName} size="sm" placement="top-end" dismissOnClick>
                {CHAT_MODELS.map((entry) => (
                  <DropdownItem key={entry.code} onClick={() => setModel(entry.code)}>
                    <span className="chat-model-name">{entry.name}</span>
                    {model === entry.code && <Check size={14} aria-hidden="true" />}
                  </DropdownItem>
                ))}
              </Dropdown>
            </div>

            {streaming ? (
              <Button type="button" variant="secondary" className="chat-send is-stop" aria-label="Stop reply" onClick={stop}>
                <Square size={14} aria-hidden="true" />
              </Button>
            ) : (
              <Button type="submit" className="chat-send" aria-label="Send" disabled={draft.trim() === ''}>
                <ArrowUp size={18} aria-hidden="true" />
              </Button>
            )}
          </form>
        </div>
      </main>
    </section>
  );
}
