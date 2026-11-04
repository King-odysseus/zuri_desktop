import { useState } from 'react';
import AuthShell from '../components/AuthShell.jsx';
import { Button, Input } from '../components/ui.jsx';
import { resetPassword } from '../lib/api.js';

// The code travels in the query string of the link from the email, so it is read
// from the address bar rather than from the app router. Reading it once at mount
// is enough: a reload of the same address simply mounts again.
function tokenFromAddress() {
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
}

// A link stops working once it is used, and an old message outlives its hour.
const DEAD_LINK_CODES = ['RESET_TOKEN_INVALID', 'TOKEN_EXPIRED', 'RESET_TOKEN_EXPIRED', 'TOKEN_USED'];

/**
 * The page the emailed link opens. Two fields, then the person is sent to the
 * sign-in screen with a line confirming the change.
 *
 * @param {{
 *   onNavigate: (path: string) => void,
 *   onNotify?: (message: string, kind?: 'info' | 'success' | 'error') => void,
 *   signedIn?: boolean,
 * }} props
 */
export default function ResetPasswordView({ onNavigate, onNotify, signedIn = false }) {
  const [token] = useState(tokenFromAddress);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deadLink, setDeadLink] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match. Type the same one twice.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await resetPassword({ token, password });
      onNotify?.('Your password is changed. Sign in with the new one.', 'success');
      onNavigate('/signin');
    } catch (failure) {
      if (DEAD_LINK_CODES.includes(failure?.code) || failure?.status === 410) {
        setDeadLink(true);
        setError('That reset link has expired or was already used. Ask for a new one and open the newest message.');
      } else {
        setError(failure?.message ?? 'The new password could not be saved. Try again in a moment.');
      }
      setBusy(false);
    }
  };

  return (
    <AuthShell
      asideTitle="Choose a new password."
      asideCopy="Something you have not used elsewhere, and at least 8 characters. Nobody at Zuri can read it."
      onNavigate={onNavigate}
    >
      <p className="eyebrow">Password help</p>
      <h2>Choose a new password</h2>

      {!token ? (
        <>
          <p className="auth-lead">
            This address has no reset code in it, so there is no password to change. Open the link
            from the email again, or ask for a fresh one.
          </p>
          <Button block onClick={() => onNavigate('/forgot-password')}>
            Ask for a new link
          </Button>
        </>
      ) : deadLink ? (
        <>
          <p className="auth-lead">
            The link that opened this page has expired, or it was already used to change a password.
            Nothing on your account has changed.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button block onClick={() => onNavigate('/forgot-password')}>
            Ask for a new link
          </Button>
        </>
      ) : (
        <>
          <p className="auth-lead">Type the new password twice so a typo cannot lock you out.</p>

          <form className="form-stack" onSubmit={submit} noValidate>
            <label className="field">
              <span>New password</span>
              <Input
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
              <Input
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

            <Button type="submit" block isDisabled={busy}>
              {busy ? 'Saving your password...' : 'Save the new password'}
            </Button>
          </form>
        </>
      )}

      <p className="auth-switch-line">
        {signedIn ? (
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/');
            }}
          >
            Back to your dashboard
          </a>
        ) : (
          <a
            href="/signin"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/signin');
            }}
          >
            Back to sign in
          </a>
        )}
      </p>
    </AuthShell>
  );
}
