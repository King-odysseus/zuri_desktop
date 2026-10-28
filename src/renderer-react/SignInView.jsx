import { useEffect, useState } from 'react';
import CloudAuthForm from './CloudAuthForm.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
// The same mark the chat screen opens with, so the first screen already looks like Zuri.
import zuriMarkUrl from './assets/zuri-logo.png';

// Mirrors SETUP_NAME_MAX_LENGTH in onboarding.js; main still has the final word.
const NAME_MAX_LENGTH = 60;

/** The theme index.html and the settings effect have already painted. */
function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** What Zuri calls the person: the account's display name, else the start of the email. */
function nameFromAccount(user) {
  const named = typeof user?.displayName === 'string' ? user.displayName.trim() : '';
  const fallback = typeof user?.email === 'string' ? user.email.split('@')[0].trim() : '';
  return (named || fallback || 'there').slice(0, NAME_MAX_LENGTH);
}

/**
 * The first screen of the installed app: sign in to a Zuri account, nothing else.
 *
 * The account holds the plan, the allowance and the usage, and the server address
 * is built in, so there is no setup to answer. Until someone signs in, the rest of
 * the app is not shown. The name Zuri greets with comes from the account.
 *
 * @param {{ onDone?: (saved: any) => void }} props
 */
export default function SignInView({ onDone }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [googleClientId, setGoogleClientId] = useState('');
  // Creating an account and recovering a password happen on this screen too, so the
  // shared form's own buttons are never dead ends.
  const [authMode, setAuthMode] = useState('sign-in');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The client id comes from the cloud server. A missing id is not an error: the
    // email and password form works without it.
    if (typeof api?.cloud?.config !== 'function') return undefined;
    let active = true;
    void api.cloud.config().then((result) => {
      if (active && result?.ok) setGoogleClientId(result.data?.googleClientId ?? '');
    });
    return () => {
      active = false;
    };
  }, [api]);

  /** Store the greeting name once a session exists, then hand over to the app. */
  async function finishSignIn() {
    setBusy(true);
    setError('');
    try {
      const account = await api?.cloud?.account?.();
      const result = await api?.onboarding?.complete?.({
        name: nameFromAccount(account?.ok ? account.data?.user : null),
        theme: currentTheme(),
      });
      if (result?.ok) {
        onDone?.(result.data);
        return;
      }
      setError(result?.error?.message ?? 'Signing in could not be finished. Try again.');
    } catch (failure) {
      setError(failure?.message ?? 'Signing in could not be finished. Try again.');
    }
    setBusy(false);
  }

  async function signInWithGoogle(credential) {
    if (busy || typeof api?.cloud?.signIn !== 'function') return;
    setBusy(true);
    setError('');
    try {
      const result = await api.cloud.signIn({ credential });
      if (!result?.ok) {
        setError(result?.error?.message ?? 'Google sign-in could not be completed.');
        setBusy(false);
        return;
      }
      await finishSignIn();
    } catch (failure) {
      setError(failure?.message ?? 'Google sign-in could not be completed.');
      setBusy(false);
    }
  }

  const resetting = authMode === 'forgot' || authMode === 'reset';
  const creating = authMode === 'create';

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground">
      {/* my-auto on the card, not justify-center on the scroller: centring an
          overflowing box pushes its top above the scroll range, which cut off the
          logo and heading on the taller create-account form. */}
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <section
          className="my-auto w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8"
          aria-labelledby="signin-title"
        >
          <img src={zuriMarkUrl} alt="Zuri" width={52} height={52} className="zuri-chat-mark" decoding="async" />
          <h1 id="signin-title" className="mt-5 text-3xl font-medium tracking-tight">
            {resetting ? 'Reset your password' : creating ? 'Create your Zuri account' : 'Sign in to Zuri'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {resetting
              ? 'We email a one-time link to the address on your account. Open it in your browser, or paste its code below to choose a new password here.'
              : 'Use your Zuri account to chat, plan and work across your devices. Sign in with Google, or with your email and password.'}
          </p>

          {!resetting && (
            <>
              <div className="mt-6">
                <GoogleSignInButton
                  clientId={googleClientId}
                  onCredential={(credential) => void signInWithGoogle(credential)}
                  onError={setError}
                />
              </div>
              <p className="mt-5 text-center text-xs uppercase tracking-wide text-muted">or</p>
            </>
          )}

          <CloudAuthForm
            mode={authMode}
            onModeChange={setAuthMode}
            onSignedIn={() => void finishSignIn()}
            api={api}
          />

          {error !== '' && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
          {busy && <p className="mt-3 text-sm text-muted">Signing you in...</p>}
        </section>
      </div>
    </main>
  );
}
