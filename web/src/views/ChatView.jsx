import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '../components/ui.jsx';
import { BackIcon, MessageIcon } from '../components/Icons.jsx';
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
import { formatRelativeTime } from '../lib/format.js';

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
export default function ChatView({ onSignIn }) {
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

  return (
    <section className="view chat-view">
      <div className="view-head">
        <div>
          <h1>Chat</h1>
          <p>Your conversations are saved to your account, so you can pick one up on any device.</p>
        </div>
      </div>

      {sessionExpired && (
        <InlineAlert tone="danger">
          <span>Your session expired. Sign in again to reach your saved chats.</span>
          {onSignIn && (
            <span className="chat-alert-action">
              <Button variant="secondary" onClick={onSignIn}>
                Sign in
              </Button>
            </span>
          )}
        </InlineAlert>
      )}
      {listError && !sessionExpired && <InlineAlert tone="danger">{listError.message}</InlineAlert>}

      <div className="chat-shell" data-pane={showThread ? 'thread' : 'list'}>
        <aside className="chat-list-pane" aria-label="Saved chats">
          <div className="chat-pane-head">
            <h2 className="chat-pane-title">Saved chats</h2>
            <Button variant="secondary" onClick={startNewChat}>
              New chat
            </Button>
          </div>

          {listStatus === 'loading' && <p className="chat-empty">Loading your chats...</p>}
          {listStatus === 'ready' && conversations.length === 0 && (
            <p className="chat-empty">Start a chat and it will be saved to your account.</p>
          )}

          <ul className="chat-list">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                {renamingId === conversation.id ? (
                  <form
                    className="chat-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveRename(conversation.id);
                    }}
                  >
                    <label className="sr-only" htmlFor={`chat-rename-${conversation.id}`}>
                      Chat name
                    </label>
                    <input
                      id={`chat-rename-${conversation.id}`}
                      className="chat-rename-input"
                      value={renameDraft}
                      maxLength={120}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      autoFocus
                    />
                    <div className="chat-row-actions">
                      <Button type="submit" variant="primary">
                        Save name
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setRenamingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`chat-row${openId === conversation.id ? ' is-active' : ''}`}
                      onClick={() => openConversation(conversation.id)}
                      aria-current={openId === conversation.id ? 'true' : undefined}
                    >
                      <span className="chat-row-title">{conversation.title || 'Untitled chat'}</span>
                      <span className="chat-row-time">
                        {formatRelativeTime(conversation.updatedAt ?? conversation.createdAt)}
                      </span>
                    </button>
                    <div className="chat-row-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Rename ${conversation.title || 'chat'}`}
                        onClick={() => {
                          setRenamingId(conversation.id);
                          setRenameDraft(conversation.title ?? '');
                          setConfirmId(null);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Delete ${conversation.title || 'chat'}`}
                        onClick={() => setConfirmId(conversation.id)}
                      >
                        Delete
                      </Button>
                    </div>
                    {confirmId === conversation.id && (
                      <div className="chat-confirm" role="alert">
                        <p>Delete this chat? It cannot be undone.</p>
                        <div className="chat-row-actions">
                          <Button type="button" variant="primary" onClick={() => removeConversation(conversation.id)}>
                            Delete chat
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setConfirmId(null)}>
                            Keep it
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </aside>

        <div className="chat-thread-pane">
          {showThread ? (
            <>
              <div className="chat-thread-head">
                <Button type="button" variant="ghost" className="chat-back" onClick={backToList}>
                  <BackIcon />
                  <span>Chats</span>
                </Button>
                <h2 className="chat-thread-title">{title}</h2>
              </div>

              {threadError && !sessionExpired && <InlineAlert tone="danger">{threadError.message}</InlineAlert>}

              <div className="chat-messages" ref={messagesRef} onScroll={onMessagesScroll} tabIndex={0} aria-label="Messages">
                {threadStatus === 'loading' && <p className="chat-empty">Loading messages...</p>}
                {threadStatus !== 'loading' && thread.messages.length === 0 && !streaming && (
                  <p className="chat-empty">
                    {openId
                      ? 'This chat has no messages yet. Ask something below and the exchange is saved here.'
                      : 'Ask anything below. This chat is saved to your account once you send.'}
                  </p>
                )}

                {thread.messages.map((message, index) => (
                  <article key={`${index}-${message.role}`} className={`chat-bubble chat-bubble-${message.role}`}>
                    <span className="chat-bubble-role">{message.role === 'user' ? 'You' : 'Zuri'}</span>
                    <p className="chat-text">{message.content}</p>
                  </article>
                ))}

                {streaming && (
                  <article className="chat-bubble chat-bubble-assistant is-streaming">
                    <span className="chat-bubble-role">Zuri</span>
                    <p className="chat-text">{streamReply || 'Thinking...'}</p>
                  </article>
                )}
              </div>

              {streamError && !sessionExpired && <InlineAlert tone="danger">{streamError.message}</InlineAlert>}
              {saveWarning && <InlineAlert tone="warning">{saveWarning}</InlineAlert>}

              <form
                className="chat-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className="sr-only" htmlFor="chat-draft">
                  Message
                </label>
                <textarea
                  id="chat-draft"
                  ref={draftRef}
                  className="chat-draft"
                  value={draft}
                  rows={3}
                  placeholder="Ask Zuri anything"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                />
                <div className="chat-composer-foot">
                  <label className="field chat-model">
                    <span>Model</span>
                    <select value={model} onChange={(event) => setModel(event.target.value)}>
                      {CHAT_MODELS.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {streaming ? (
                    <Button type="button" variant="secondary" onClick={stop}>
                      Stop
                    </Button>
                  ) : (
                    <Button type="submit" disabled={!draft.trim()}>
                      Send
                    </Button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <div className="chat-empty-pane">
              <MessageIcon />
              <p>Choose a saved chat, or start a new one.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
