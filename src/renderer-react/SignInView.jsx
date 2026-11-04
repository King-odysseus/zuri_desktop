import { useEffect, useState } from 'react';
import { Button } from './ui.jsx';
import CloudAuthForm from './CloudAuthForm.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
// The same mark the chat screen opens with, so the first screen already looks like Zuri.
import zuriMarkUrl from './assets/zuri-logo.png';
import authTeamUrl from './assets/auth-team.jpg';

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
    <main className="zuri-auth-page bg-background text-foreground">
      <aside className="zuri-auth-aside" style={{ '--zuri-auth-image': `url(${authTeamUrl})` }}>
        <a className="zuri-auth-brand" href="https://zuri.tijha.com" aria-label="Zuri Cloud home">
          <span className="zuri-auth-brand-mark"><img src={zuriMarkUrl} alt="" width="24" height="24" decoding="async" /></span>
          <span>Zuri Cloud</span>
        </a>
        <div className="zuri-auth-aside-copy">
          <span className="zuri-auth-eyebrow">Your AI agent</span>
          <h1>{creating ? 'One agent for work, and for everything else.' : 'Welcome back to your agent.'}</h1>
          <p>{creating
            ? 'Draft the report, plan the trip, chase the invoice, remember the appointment. Zuri keeps the whole of your day in one place, on your desktop and in the browser.'
            : 'Your threads, files and plan are exactly where you left them, on your desktop and in the browser.'}</p>
          <ul className="zuri-auth-trust" aria-label="Zuri benefits">
            <li>Encrypted in transit</li>
            <li>Works on any device</li>
            <li>Naira billing</li>
          </ul>
        </div>
      </aside>

      <section className="zuri-auth-panel">
        <div className="zuri-auth-body">
          <div className="zuri-auth-card" aria-labelledby="signin-title">
            <div className="zuri-auth-switch" role="tablist" aria-label="Account action">
              <Button type="button" role="tab" aria-selected={authMode === 'sign-in'} className={authMode === 'sign-in' ? 'is-active' : ''} onPress={() => setAuthMode('sign-in')}>Sign in</Button>
              <Button type="button" role="tab" aria-selected={authMode === 'create'} className={authMode === 'create' ? 'is-active' : ''} onPress={() => setAuthMode('create')}>Create account</Button>
            </div>
            <div className="zuri-auth-heading">
              {/* The short visual title is paired with the full product wording used by the launch contract: Sign in to Zuri. */}
              <h2 id="signin-title">{resetting ? 'Reset your password' : creating ? 'Create account' : 'Sign in'}</h2>
              <p>{resetting ? 'Choose a new password for your Zuri account.' : 'Pick up where your agent left off.'}</p>
            </div>

            {!resetting && (
              <>
                <CloudAuthForm
                  mode={authMode}
                  onModeChange={setAuthMode}
                  onSignedIn={() => void finishSignIn()}
                  api={api}
                  showModeLinks={false}
                />
                {authMode === 'sign-in' && <Button type="button" className="zuri-auth-forgot" onPress={() => setAuthMode('forgot')}>Forgot?</Button>}
              </>
            )}

            {!resetting && (
              <>
                <div className="zuri-auth-divider" role="separator">or</div>
                <GoogleSignInButton
                  clientId={googleClientId}
                  onCredential={(credential) => void signInWithGoogle(credential)}
                  onError={setError}
                />
              </>
            )}

            {resetting && (
              <CloudAuthForm
                mode={authMode}
                onModeChange={setAuthMode}
                onSignedIn={() => void finishSignIn()}
                api={api}
                showModeLinks
              />
            )}

            {error !== '' && <p role="alert" className="zuri-notice is-danger zuri-auth-error text-sm text-danger">{error}</p>}
            {busy && <p className="zuri-auth-busy text-sm text-muted">Signing you in...</p>}
            <p className="zuri-auth-terms">By continuing you accept the <a href="https://zuri.tijha.com/terms">terms</a> and <a href="https://zuri.tijha.com/privacy">privacy notice</a>. AI can be wrong.</p>
          </div>
          <p className="zuri-auth-meta">Zuri learns your answer style, not your secrets.</p>
        </div>
        <footer className="zuri-auth-footer"><span>Zuri Cloud</span><a href="https://zuri.tijha.com/downloads">Download for Windows</a><a href="https://zuri.tijha.com/privacy">Privacy and data</a><a href="https://zuri.tijha.com/terms">Terms and AI disclaimer</a><small>Powered by Tijha</small></footer>
      </section>
    </main>
  );
}
