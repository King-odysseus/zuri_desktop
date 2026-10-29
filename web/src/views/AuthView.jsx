import { useEffect, useState } from 'react';
import AuthShell from '../components/AuthShell.jsx';
import GoogleSignIn from '../components/GoogleSignIn.jsx';
import { Button } from '../components/ui.jsx';

const COPY = {
  signin: {
    title: 'Sign in',
    lead: 'Pick up where your agent left off.',
    submit: 'Sign in',
    busy: 'Signing in...',
  },
  signup: {
    title: 'Create your account',
    lead: 'One account for your agent, on desktop and in the browser.',
    submit: 'Create account',
    busy: 'Creating your account...',
  },
};

// The server names each refusal. These are the sentences behind those names:
// what went wrong, and what to do about it. A name we do not know falls through
// to whatever the server said, so a new refusal is never a blank screen.
const ERROR_COPY = {
  EMAIL_TAKEN: 'An account already uses that email. Try signing in instead.',
  INVALID_CREDENTIALS: 'That email and password do not match.',
  EMAIL_INVALID: 'That email address does not look right. Check it and try again.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_WEAK: 'Use at least 8 characters for your password.',
  PASSWORD_NOT_SET:
    'This account signs in with Google. Continue with Google below, or set a password from the Account page after you are in.',
  TOO_MANY_REQUESTS: 'That is a lot of tries in a short time. Wait a minute, then try again.',
};

/** @param {any} error */
function messageFor(error) {
  return ERROR_COPY[error?.code] ?? error?.message ?? 'Something went wrong. Try again.';
}

// Checked here rather than by the browser so the message appears in the same
// place as a refusal from the server instead of in a speech bubble.
function problemWith({ email, password, displayName }, mode) {
  if (!email) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'That email address does not look right. Check it and try again.';
  }
  if (mode === 'signup' && displayName.length < 2) {
    return 'Enter your name so the dashboard can greet you.';
  }
  if (!password) return 'Enter your password.';
  if (mode === 'signup' && password.length < 8) return 'Use at least 8 characters for your password.';
  return '';
}

/**
 * The two account screens, kept short so the whole form fits a phone without
 * scrolling: the tabs, one line of copy, the fields, the button, then Google.
 *
 * The rules and the server's own refusal sentences are unchanged; only the
 * stacked explanations that used to sit under the button are gone, because the
 * colour panel beside the card already says them and a phone had to scroll past
 * them to reach the fields.
 *
 * @param {{
 *   mode: 'signin' | 'signup',
 *   theme: 'dark' | 'light',
 *   onCredential: (credential: string) => Promise<void>,
 *   onError: (message: string) => void,
 *   onNavigate: (path: string) => void,
 *   onPasswordSignIn: (input: { mode: 'signin' | 'signup', email: string, password: string, displayName: string }) => Promise<void>,
 * }} props
 */
export default function AuthView({ mode, theme, onCredential, onError, onNavigate, onPasswordSignIn }) {
  const copy = COPY[mode] ?? COPY.signin;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Switching tabs keeps the typed email (useful when the password was wrong)
  // but must not carry the old refusal onto the other screen.
  useEffect(() => {
    setError('');
  }, [mode]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = { email: email.trim(), password, displayName: displayName.trim() };
    const problem = problemWith(input, mode);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onPasswordSignIn({ ...input, mode });
    } catch (failure) {
      setError(messageFor(failure));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      asideTitle={mode === 'signup' ? 'One agent for work, and for everything else.' : 'Welcome back to your agent.'}
      asideCopy={
        mode === 'signup'
          ? 'Draft the report, plan the trip, chase the invoice, remember the appointment. Zuri keeps the whole of your day in one place, on your desktop and in the browser.'
          : 'Your threads, files and plan are exactly where you left them, on your desktop and in the browser.'
      }
      onNavigate={onNavigate}
    >
      <div className="auth-switch" role="tablist" aria-label="Account action">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`auth-switch-btn${mode === 'signin' ? ' is-active' : ''}`}
          onClick={() => onNavigate('/signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`auth-switch-btn${mode === 'signup' ? ' is-active' : ''}`}
          onClick={() => onNavigate('/signup')}
        >
          Create account
        </button>
      </div>

      <div className="auth-heading">
        <h2>{copy.title}</h2>
        <p className="auth-lead">{copy.lead}</p>
      </div>

      <form className="form-stack" onSubmit={submit} noValidate>
        {mode === 'signup' && (
          <label className="field">
            <span>Full name</span>
            <input
              type="text"
              name="name"
              autoComplete="name"
              placeholder="Ada Obi"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}

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

        <label className="field">
          <span className="field-head">
            <span>Password</span>
            {/* Beside its own field rather than on a row of its own: it belongs to
                this input, and a separate line cost the form a whole row. */}
            {mode === 'signin' && (
              <a
                className="field-aside"
                href="/forgot-password"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate('/forgot-password');
                }}
              >
                Forgot?
              </a>
            )}
          </span>
          <input
            type="password"
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" block disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </Button>
      </form>

      <div className="form-divider" role="separator" aria-orientation="horizontal">
        or
      </div>

      <GoogleSignIn theme={theme} onCredential={onCredential} onError={onError} />

      {/* One line instead of a paragraph: the full notices are one tap away and
          nobody reads a wall of terms to sign in. */}
      <p className="auth-terms">
        By continuing you accept the{' '}
        <a href="/terms" target="_blank" rel="noreferrer">
          terms
        </a>{' '}
        and{' '}
        <a href="/privacy" target="_blank" rel="noreferrer">
          privacy notice
        </a>
        . AI can be wrong.
      </p>
    </AuthShell>
  );
}
