import { useState } from 'react';
import { DataRow } from '../components/DataRow.jsx';
import { Button } from '../components/ui.jsx';
import { setPassword } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

/** @param {unknown} value Turns "past_due" into "Past due" for a reading eye. */
function statusLabel(value) {
  const words = typeof value === 'string' && value ? value.replace(/_/g, ' ') : 'active';
  return words.charAt(0).toUpperCase() + words.slice(1);
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

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        <span className="chip">{statusLabel(user.status)}</span>
      </div>

      <article className="card">
        <p className="stat-label">Your details</p>
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
