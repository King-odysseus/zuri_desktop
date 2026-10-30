import { useEffect, useState } from 'react';
import { DataRow } from '../components/DataRow.jsx';
import { Button } from '../components/ui.jsx';
import { createMemory, deleteMemory, listMemories, setPassword, updateAccountName, updateMemory } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

/** @param {unknown} value Turns "past_due" into "Past due" for a reading eye. */
function statusLabel(value) {
  const words = typeof value === 'string' && value ? value.replace(/_/g, ' ') : 'active';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The pill colour for an account status: green while the account is in good
 * standing, red once it is suspended, amber while it waits on something.
 */
function statusTone(value) {
  const status = String(value ?? 'active').toLowerCase();
  if (status === 'suspended' || status === 'blocked' || status === 'disabled') return ' chip-danger';
  if (status === 'pending') return ' chip-warning';
  return ' chip-success';
}

const PASSWORD_ERRORS = {
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_WEAK: 'Use at least 8 characters for your password.',
  PASSWORD_ALREADY_SET: 'This account already has a password. Use the reset link to change it.',
};

/**
 * Who is signed in, and the one thing about the account they can change here: a
 * password beside Google, so an account made with the Google button is not tied
 * to that button for ever.
 *
 * @param {{
 *   me: any,
 *   onSignOut: () => void,
 * }} props
 */
export default function AccountView({ me, onSignOut }) {
  const user = me?.user ?? {};
  const subscription = me?.subscription ?? {};
  const name = user.displayName || user.email || 'Zuri user';
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState(null);
  const [passwordAdded, setPasswordAdded] = useState(false);
  const canSetPassword = user.hasPassword === false && !passwordAdded;
  const hasPassword = user.hasPassword === true || passwordAdded;
  // undefined means the server does not talk about passwords yet, so no claim is
  // made about how the account signs in and no save is offered that it would
  // refuse.
  const reportsPassword = typeof user.hasPassword === 'boolean';
  const passwordNote = passwordAdded
    ? 'Password saved. Sign in with your email and this password, or with Google. Both open the same account.'
    : hasPassword
      ? 'This account already has a password. Use "Forgot your password?" on the sign-in screen to change it.'
      : 'Password settings are not reported for this account, so there is nothing to set here. Sign in with Google.';

  const [memories, setMemories] = useState([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryStatus, setMemoryStatus] = useState('loading');
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState(null);
  const [editingMemoryId, setEditingMemoryId] = useState('');
  const [editingMemoryText, setEditingMemoryText] = useState('');

  useEffect(() => {
    let cancelled = false;
    listMemories()
      .then((items) => {
        if (!cancelled) {
          setMemories(items);
          setMemoryStatus('ready');
        }
      })
      .catch((failure) => {
        if (!cancelled) {
          setMemoryStatus('error');
          setMemoryMessage({ text: failure?.message ?? 'Memories could not be loaded.', ok: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveMemory = async (event) => {
    event.preventDefault();
    const content = memoryDraft.trim();
    if (content === '' || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryMessage(null);
    try {
      const memory = await createMemory(content);
      setMemories((current) => [memory, ...current]);
      setMemoryDraft('');
      setMemoryMessage({ text: 'Memory saved.', ok: true });
    } catch (failure) {
      setMemoryMessage({ text: failure?.message ?? 'That memory could not be saved.', ok: false });
    } finally {
      setMemoryBusy(false);
    }
  };

  const removeMemory = async (memory) => {
    if (!memory?.id || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryMessage(null);
    try {
      await deleteMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setMemoryMessage({ text: 'Memory deleted.', ok: true });
    } catch (failure) {
      setMemoryMessage({ text: failure?.message ?? 'That memory could not be deleted.', ok: false });
    } finally {
      setMemoryBusy(false);
    }
  };

  const saveEditedMemory = async (event) => {
    event.preventDefault();
    if (!editingMemoryId || memoryBusy) return;
    const content = editingMemoryText.trim();
    if (content === '') return;
    setMemoryBusy(true);
    setMemoryMessage(null);
    try {
      const saved = await updateMemory(editingMemoryId, content);
      setMemories((current) => current.map((item) => item.id === saved.id ? saved : item));
      setEditingMemoryId('');
      setEditingMemoryText('');
      setMemoryMessage({ text: 'Memory updated.', ok: true });
    } catch (failure) {
      setMemoryMessage({ text: failure?.message ?? 'That memory could not be updated.', ok: false });
    } finally {
      setMemoryBusy(false);
    }
  };

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveName = async (event) => {
    event.preventDefault();
    if (nameBusy) return;
    const nextName = displayName.trim();
    if (nextName.length > 60) {
      setNameMessage({ text: 'Use 60 characters or fewer for your name.', ok: false });
      return;
    }
    setNameBusy(true);
    setNameMessage(null);
    try {
      await updateAccountName(nextName);
      setNameMessage({ text: 'Name saved.', ok: true });
      window.dispatchEvent(new CustomEvent('zuri:account-updated', { detail: { displayName: nextName } }));
    } catch (failure) {
      setNameMessage({ text: failure?.message ?? 'The name could not be saved.', ok: false });
    } finally {
      setNameBusy(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match. Type the same one twice.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await setPassword(password);
      setPasswordAdded(true);
      setPassword('');
      setConfirm('');
    } catch (failure) {
      setError(PASSWORD_ERRORS[failure?.code] ?? failure?.message ?? 'The password was not saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Account</h1>
          <p>Who is signed in, the plan behind it, and how to get back in next time.</p>
        </div>
        <span className={`chip${statusTone(user.status)}`}>{statusLabel(user.status)}</span>
      </div>

      <article className="card">
        <p className="stat-label">Your details</p>
        <form className="form-stack" onSubmit={saveName} style={{ marginTop: 12 }} noValidate>
          <label className="field">
            <span>Your name</span>
            <input value={displayName} maxLength={60} onChange={(event) => setDisplayName(event.target.value)} placeholder="What should Zuri call you?" />
          </label>
          {nameMessage && <p className={nameMessage.ok ? 'form-success' : 'form-error'} role="status">{nameMessage.text}</p>}
          <div className="card-actions"><Button type="submit" disabled={nameBusy}>{nameBusy ? 'Saving...' : 'Save name'}</Button></div>
        </form>
        <div className="row-list" style={{ marginTop: 8 }}>
          <DataRow label="Name">{name}</DataRow>
          <DataRow label="Email">{user.email ?? 'Not set'}</DataRow>
          <DataRow label="Plan">{subscription.planName ?? 'Starter'}</DataRow>
          <DataRow label="Status">{statusLabel(user.status)}</DataRow>
          <DataRow label="Member since">{formatDate(user.createdAt)}</DataRow>
          {reportsPassword && (
            <DataRow label="Sign-in method">
              {hasPassword ? 'Email and password, or Google' : 'Google'}
            </DataRow>
          )}
        </div>
      </article>

      <article className="card">
        <p className="stat-label">Saved memories</p>
        <p className="stat-meta">
          Short facts and preferences you choose to keep across chats. Zuri uses them as context, and you can remove them at any time.
        </p>
        <form className="form-stack" onSubmit={saveMemory} style={{ marginTop: 12 }} noValidate>
          <label className="field">
            <span>Add a memory</span>
            <textarea
              value={memoryDraft}
              maxLength={500}
              rows={3}
              onChange={(event) => setMemoryDraft(event.target.value)}
              placeholder="For example: I prefer short, plain-English reports."
            />
          </label>
          <div className="card-actions"><Button type="submit" disabled={memoryBusy || memoryDraft.trim() === ''}>{memoryBusy ? 'Saving...' : 'Save memory'}</Button></div>
        </form>
        {memoryMessage && <p className={memoryMessage.ok ? 'form-success' : 'form-error'} role="status">{memoryMessage.text}</p>}
        {memoryStatus === 'loading' && <p className="stat-meta">Loading memories...</p>}
        {memoryStatus === 'ready' && memories.length === 0 && <p className="stat-meta">No saved memories yet.</p>}
        {memories.length > 0 && (
          <ul className="row-list" style={{ marginTop: 12 }}>
            {memories.map((memory) => (
              <li className="data-row" key={memory.id}>
                {editingMemoryId === memory.id ? (
                  <form className="form-stack" onSubmit={saveEditedMemory} style={{ flex: 1 }}>
                    <textarea value={editingMemoryText} maxLength={500} rows={2} onChange={(event) => setEditingMemoryText(event.target.value)} />
                    <div className="card-actions">
                      <Button type="submit" size="sm" disabled={memoryBusy || editingMemoryText.trim() === ''}>Save</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={memoryBusy} onClick={() => setEditingMemoryId('')}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <span className="data-row-label">{memory.content}</span>
                    <div className="card-actions">
                      <Button variant="ghost" size="sm" disabled={memoryBusy} onClick={() => { setEditingMemoryId(memory.id); setEditingMemoryText(memory.content); }}>Edit</Button>
                      <Button variant="ghost" size="sm" disabled={memoryBusy} onClick={() => void removeMemory(memory)}>Delete</Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card">
        <p className="stat-label">Password</p>
        {canSetPassword ? (
          <>
            <p className="stat-meta">
              This account signs in with Google. Add a password and the same account opens with your
              email and that password too. Your plan, usage and history stay where they are.
            </p>
            <form className="form-stack" onSubmit={save} style={{ marginTop: 12 }} noValidate>
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              <label className="field">
                <span>New password again</span>
                <input
                  type="password"
                  name="confirm"
                  autoComplete="new-password"
                  placeholder="The same password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <div className="card-actions">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving...' : 'Set a password'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <p className="stat-meta">{passwordNote}</p>
        )}
      </article>

      <article className="card">
        <p className="stat-label">Session</p>
        <p className="stat-meta">
          Signing out here ends this browser session. The desktop app keeps its own sign-in and is not
          touched.
        </p>
        <div className="card-actions">
          <Button variant="secondary" onClick={() => onSignOut?.()}>
            Sign out
          </Button>
        </div>
      </article>
    </section>
  );
}
