import { useState } from 'react';
import AuthShell from '../components/AuthShell.jsx';
import { Button } from '../components/ui.jsx';
import { requestPasswordReset } from '../lib/api.js';

/**
 * Asks for the email on the account and sends one link. The page never says
 * whether that address is registered: the answer is the same either way, so it
 * cannot be used to find out who has an account here.
 *
 * @param {{
 *   onNavigate: (path: string) => void,
 *   signedIn?: boolean,
 * }} props
 */
export default function ForgotPasswordView({ onNavigate, signedIn = false }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) {
      setError('Enter the email you signed up with.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('That email address does not look right. Check it and try again.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await requestPasswordReset(address);
      setSentTo(address);
    } catch (failure) {
      // A server with no mail settings cannot send anything. Saying so is
      // better than telling someone to wait for a message that is not coming.
      if (failure?.code === 'MAIL_NOT_CONFIGURED') {
        setError(
          'Email is not set up on this server yet, so the reset link cannot be sent. Nothing has changed on your account. Ask the site owner to finish the mail settings.',
        );
      } else {
        setError(failure?.message ?? 'The request did not go through. Try again in a moment.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      asideTitle="Get back into your account."
      asideCopy="One email, one link, one new password. Your plan, your usage and your files stay exactly as they were."
      onNavigate={onNavigate}
    >
      <p className="eyebrow">Password help</p>
      <h2>Reset your password</h2>
      <p className="auth-lead">
        Type the email on your account. If it matches, we send a link that lets you choose a new
        password. The link is good for one hour.
      </p>

      {sentTo ? (
        <>
          <p className="form-success" role="status">
            If an account uses {sentTo}, the link is on its way. Open the newest message and follow
            the link. Nothing arrived after a few minutes? Look in spam, then try again.
          </p>
          <Button
            variant="secondary"
            block
            onClick={() => {
              setSentTo('');
              setError('');
            }}
          >
            Use a different email
          </Button>
        </>
      ) : (
        <form className="form-stack" onSubmit={submit} noValidate>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" block disabled={busy}>
            {busy ? 'Sending the link...' : 'Send the link'}
          </Button>
        </form>
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
