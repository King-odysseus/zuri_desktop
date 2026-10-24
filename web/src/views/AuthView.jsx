import { useEffect, useState } from 'react';
import AuthShell from '../components/AuthShell.jsx';
import GoogleSignIn from '../components/GoogleSignIn.jsx';
import { Button } from '../components/ui.jsx';
import { CheckIcon } from '../components/Icons.jsx';

const COPY = {
  signin: {
    eyebrow: 'Welcome back',
    title: 'Sign in to Zuri Cloud',
    lead: 'Pick up your plan, your usage and your billing exactly where you left them.',
    submit: 'Sign in',
    busy: 'Signing in...',
    switchText: 'New to Zuri Cloud?',
    switchLabel: 'Create an account',
    switchHref: '/signup',
  },
  signup: {
    eyebrow: 'Get started',
    title: 'Create your Zuri Cloud account',
    lead: 'One account for this dashboard and the desktop app. Use an email and a password, or continue with Google below.',
    submit: 'Create account',
    busy: 'Creating your account...',
    switchText: 'Already have an account?',
    switchLabel: 'Sign in',
    switchHref: '/signin',
  },
};

const BENEFITS = [
  { icon: <CheckIcon />, text: 'The free plan starts with 100,000 tokens every month.' },
  { icon: <CheckIcon />, text: 'Company, school and custom-domain Google accounts work too.' },
  { icon: <CheckIcon />, text: 'Same quota and history on the desktop app and in the browser.' },
];

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
 * The two account screens. The form is the main way in; Google sits under a
 * quiet "or" for people who signed up that way.
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
      asideTitle={mode === 'signup' ? 'Your AI command centre, in the cloud.' : 'Good to see you again.'}
      asideCopy={
        mode === 'signup'
          ? 'One account for the assistant on your desktop and this dashboard. Start free, move up a plan when the work grows.'
          : 'Your threads, your files and your plan are waiting on the other side of this form.'
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

      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{copy.title}</h2>
      <p className="auth-lead">{copy.lead}</p>

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
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {mode === 'signin' && (
          <p className="auth-switch-line">
            <a
              href="/forgot-password"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/forgot-password');
              }}
            >
              Forgot your password?
            </a>
          </p>
        )}

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

      <ul className="auth-benefits">
        {BENEFITS.map((item) => (
          <li key={item.text}>
            {item.icon}
            <span>{item.text}</span>
          </li>
        ))}
      </ul>

      <p className="auth-switch-line">
        {copy.switchText}{' '}
        <a
          href={copy.switchHref}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(copy.switchHref);
          }}
        >
          {copy.switchLabel}
        </a>
      </p>

      <p className="auth-terms">
        By continuing you agree to Zuri Cloud keeping your account, usage and payment records so the
        dashboard can show them. A password is stored only as a one-way hash, and Zuri never posts to
        your Google account.
      </p>

      <Button variant="ghost" block className="auth-back" onClick={() => onNavigate('/')}>
        Back to home
      </Button>
    </AuthShell>
  );
}
