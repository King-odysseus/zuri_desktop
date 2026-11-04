import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, IconButton, InlineAlert, Input } from '../components/ui.jsx';
import { ArchiveIcon, BackIcon, ChatIcon, DeleteIcon, SearchIcon } from '../components/Icons.jsx';
import { deleteConversation, fetchConversations, setConversationFlags } from '../lib/api.js';
import { formatRelativeTime } from '../lib/format.js';

// Typing in the search field should not send a request per keystroke, so the query
// settles for a moment first. It is short enough to feel immediate.
const SEARCH_SETTLE_MS = 250;

/** A chat with no name still needs one to be spoken about in a button's label. */
function nameOf(conversation) {
  const title = String(conversation?.title ?? '').trim();
  return title === '' ? 'New chat' : title;
}

/** What was last said, flattened to a line: the row clips whatever does not fit. */
function previewOf(conversation) {
  return String(conversation?.preview ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stampOf(conversation) {
  const time = new Date(conversation?.updatedAt ?? conversation?.createdAt ?? 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Every chat the account has, including the ones archived out of Recents.
 *
 * The Recents column is a working list, so it only carries live chats. Deleting one
 * or clearing the lot is a deliberate act, and it belongs on a screen where the whole
 * history, archived chats included, is on show and where nothing else competes for
 * the same press. Restoring an archived chat puts it back in Recents.
 */
export default function HistoryView({ onBackToChat = () => {}, onChanged = () => {} }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async (search) => {
    setStatus('loading');
    try {
      // Archived chats are the reason this screen exists, so they travel with the rest.
      const list = await fetchConversations(search, '', true);
      setRows(Array.isArray(list) ? list : []);
      setStatus('ready');
      setError('');
    } catch (loadError) {
      setStatus('failed');
      setError(loadError?.message || 'Your chat history could not be loaded.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query.trim()), SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  /** Deleting is permanent, so the row asks once, in place, before it goes. */
  const deleteOne = useCallback(
    async (conversation) => {
      if (busyId !== '') return;
      setBusyId(conversation.id);
      setActionError('');
      try {
        await deleteConversation(conversation.id);
        setRows((current) => current.filter((row) => row.id !== conversation.id));
        setConfirmId('');
        onChanged();
      } catch (deleteError) {
        setActionError(deleteError?.message || 'That chat could not be deleted.');
      } finally {
        setBusyId('');
      }
    },
    [busyId, onChanged],
  );

  /** An archived chat returns to Recents; it stays listed here, now without a badge. */
  const restore = useCallback(
    async (conversation) => {
      if (busyId !== '') return;
      setBusyId(conversation.id);
      setActionError('');
      try {
        await setConversationFlags(conversation.id, { archived: false });
        setRows((current) => current.map((row) => (row.id === conversation.id ? { ...row, archived: false } : row)));
        onChanged();
      } catch (restoreError) {
        setActionError(restoreError?.message || 'That chat could not be restored.');
      } finally {
        setBusyId('');
      }
    },
    [busyId, onChanged],
  );

  /**
   * Clearing the history deletes the chats one by one, because one failing delete
   * should not abandon the rest. The first fault is reported and the row that could
   * not go stays on the list, so nothing disappears that is still there.
   */
  const clearAll = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    setActionError('');
    const failed = new Set();
    for (const conversation of rows) {
      try {
        await deleteConversation(conversation.id);
      } catch {
        failed.add(conversation.id);
      }
    }
    setRows((current) => current.filter((row) => failed.has(row.id)));
    setConfirmClear(false);
    setClearing(false);
    onChanged();
    if (failed.size > 0) {
      setActionError(
        failed.size === 1
          ? 'One chat could not be deleted and is still listed.'
          : `${failed.size} chats could not be deleted and are still listed.`,
      );
    }
  }, [clearing, onChanged, rows]);

  const archivedCount = rows.filter((row) => row.archived).length;

  return (
    <section className="view history-view">
      <div className="view-head">
        <div>
          <h1>Chat history</h1>
          <p>
            Every chat on this account, including the ones archived out of Recents. Restore one to put it back,
            or delete the ones you no longer need.
          </p>
        </div>
        <Button variant="secondary" onClick={() => onBackToChat()}>
          <BackIcon size={16} aria-hidden="true" />
          Back to chat
        </Button>
      </div>

      {status === 'failed' && <InlineAlert tone="danger">{error}</InlineAlert>}
      {actionError !== '' && <InlineAlert tone="danger">{actionError}</InlineAlert>}

      <div className="history-toolbar">
        <label className="history-search">
          <SearchIcon size={16} aria-hidden="true" />
          <Input
            aria-label="Search your chats"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your chats"
            maxLength={120}
          />
        </label>
        {rows.length > 0 &&
          (confirmClear ? (
            <div className="history-confirm">
              <span>
                Delete {rows.length === 1 ? 'this chat' : `all ${rows.length} chats`}? This cannot be undone.
              </span>
              <Button variant="ghost" className="history-confirm-delete" isDisabled={clearing} onClick={() => void clearAll()}>
                {clearing ? 'Deleting...' : 'Yes, delete'}
              </Button>
              <Button variant="ghost" isDisabled={clearing} onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              <DeleteIcon size={16} aria-hidden="true" />
              Delete all
            </Button>
          ))}
      </div>

      {archivedCount > 0 && (
        <p className="history-note">
          {archivedCount === 1 ? '1 chat is archived.' : `${archivedCount} chats are archived.`} Archived chats stay
          here until you restore or delete them.
        </p>
      )}

      {status === 'loading' && rows.length === 0 && <p className="history-empty">Reading your chats...</p>}
      {status === 'ready' && rows.length === 0 && (
        <p className="history-empty">
          {query.trim() === '' ? 'No chats yet. Every chat you start appears here.' : 'No chats match that search.'}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="history-list">
          {rows.map((conversation) => (
            <li key={conversation.id} className="history-row">
              <span className="history-icon" aria-hidden="true">
                <ChatIcon size={16} />
              </span>
              <div className="history-main">
                <p className="history-name">
                  {nameOf(conversation)}
                  {conversation.archived && <Chip tone="default">Archived</Chip>}
                </p>
                {previewOf(conversation) !== '' && <p className="history-preview">{previewOf(conversation)}</p>}
                <p className="history-meta">{formatRelativeTime(stampOf(conversation) || undefined)}</p>
              </div>
              <div className="history-actions">
                {confirmId === conversation.id ? (
                  <>
                    <Button
                      variant="ghost"
                      className="history-confirm-delete"
                      isDisabled={busyId === conversation.id}
                      onClick={() => void deleteOne(conversation)}
                    >
                      {busyId === conversation.id ? 'Deleting...' : 'Delete'}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmId('')}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    {conversation.archived && (
                      <IconButton
                        label={`Restore ${nameOf(conversation)} to Recents`}
                        size="sm"
                        isDisabled={busyId === conversation.id}
                        onClick={() => void restore(conversation)}
                      >
                        <ArchiveIcon size={16} aria-hidden="true" />
                      </IconButton>
                    )}
                    <IconButton
                      label={`Delete ${nameOf(conversation)}`}
                      size="sm"
                      className="history-delete"
                      isDisabled={busyId === conversation.id || clearing}
                      onClick={() => setConfirmId(conversation.id)}
                    >
                      <DeleteIcon size={16} aria-hidden="true" />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
