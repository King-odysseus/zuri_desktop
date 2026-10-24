import { useState } from 'react';
import { Button } from './ui.jsx';
import { UserPlusIcon } from './Icons.jsx';
import CloudAuthForm from './CloudAuthForm.jsx';

/**
 * Cloud account entry point. An email and password is the primary route, and
 * Google stays available because Workspace identities are intentionally not
 * restricted to gmail.com: company, school and custom domains can join too.
 */
export default function SignUpView({ onNavigate }) {
  // 'sign-in' is not a mode here: that screen is the cloud route, so the form's
  // sign-in link navigates instead of switching.
  const [mode, setMode] = useState('create');
  const resetting = mode === 'forgot' || mode === 'reset';

  function changeMode(next) {
    if (next === 'sign-in') {
      onNavigate?.('cloud');
      return;
    }
    setMode(next);
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden flex items-center justify-center">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8" aria-labelledby="signup-title">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <UserPlusIcon size={22} />
          </div>
          <h1 id="signup-title" className="mt-5 text-3xl font-medium tracking-tight">
            {resetting ? 'Reset your password' : 'Create your Zuri Cloud account'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {resetting
              ? 'We email a one-time link to the address on your account. Open it in your browser, or paste its code below to choose a new password here.'
              : 'Use any email address and a password of at least 8 characters. If you would rather use Google, that works too, including company, school and other custom-domain Workspace accounts.'}
          </p>

          <CloudAuthForm
            mode={mode}
            onModeChange={changeMode}
            onSignedIn={() => onNavigate?.('cloud')}
          />

          {!resetting && (
            <>
              <p className="mt-6 text-center text-xs uppercase tracking-wide text-muted">or</p>
              <Button type="button" variant="secondary" fullWidth className="mt-3" onPress={() => onNavigate?.('cloud')}>
                Continue with Google
              </Button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
