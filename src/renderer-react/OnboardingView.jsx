import { useEffect, useState } from 'react';
import { Button, Input } from './ui.jsx';
import { CloudIcon, MoonIcon, SunIcon, UserPlusIcon } from './Icons.jsx';
import CloudAuthForm from './CloudAuthForm.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';

// Mirrors SETUP_NAME_MAX_LENGTH in onboarding.js, so the obvious mistakes are
// answered without a round trip. Main still has the final word.
const NAME_MAX_LENGTH = 60;

const THEMES = [
  { id: 'light', label: 'Light', icon: <SunIcon size={16} /> },
  { id: 'dark', label: 'Dark', icon: <MoonIcon size={16} /> },
];

/** The theme index.html and the settings effect have already painted. */
function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** @param {string} name Already trimmed. @returns {string} Empty when it is fine. */
function nameProblem(name) {
  if (name === '') return 'Add your name so Zuri knows what to call you.';
  if (name.length > NAME_MAX_LENGTH) return `Keep your name to ${NAME_MAX_LENGTH} characters or fewer.`;
  return '';
}

/**
 * First run, in two screens: who you are and which theme you want, then the Zuri
 * account.
 *
 * The account replaced the old provider-key screen. It is what carries the plan,
 * the monthly allowance and the usage figures, so asking for an OpenAI or
 * Anthropic key on launch made the first minute of the product look like a
 * developer tool. A key is still supported, but it now belongs in Settings, where
 * a person who wants to pay a provider directly can add one.
 *
 * Signing in is offered, not forced: "Skip for now" still writes the name and
 * theme, so a person who is offline or has no account yet is not stuck on this
 * screen.
 *
 * @param {{ onDone?: (saved: any) => void }} props
 */
export default function OnboardingView({ onDone }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState(currentTheme);
  const [googleClientId, setGoogleClientId] = useState('');
  // Creating an account and recovering a password happen inside this card too, so
  // the shared form's own buttons are never dead ends.
  const [authMode, setAuthMode] = useState('sign-in');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const trimmedName = name.trim();
  const problem = nameProblem(trimmedName);
  // Main's refusal wins; before one arrives, the field explains itself as soon as
  // something has been typed, so an empty box is not shouted at.
  const nameError = error || (trimmedName === '' ? '' : problem);

  useEffect(() => {
    // The client id comes from the cloud server, and reaches this page before the
    // Google button can be drawn. A missing id is not an error: the email and
    // password form below works without it.
    if (step !== 2 || typeof api?.cloud?.config !== 'function') return;
    let active = true;
    void api.cloud.config().then((result) => {
      if (active && result?.ok) setGoogleClientId(result.data?.googleClientId ?? '');
    });
    return () => {
      active = false;
    };
  }, [step, api]);

  function chooseTheme(next) {
    setTheme(next);
    // This card is the whole window, so the choice has to be visible before it is
    // stored: paint the tokens now and save them with the rest on finish.
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
  }

  function continueToAccount() {
    if (problem !== '') {
      setError(problem);
      return;
    }
    setError('');
    setStep(2);
  }

  /**
   * Store the two answers this card owns and close setup.
   *
   * No key travels with them any more, which is why main's onboarding channel now
   * accepts a payload without one. The account session, when there is one, was
   * already written by the cloud sign-in calls.
   * @returns {Promise<boolean>} true when setup was saved and the caller can stop.
   */
  async function finishSetup() {
    if (typeof api?.onboarding?.complete !== 'function') {
      setError('Setup can only be finished inside the Zuri app.');
      return false;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.onboarding.complete({ name: trimmedName, theme });
      if (result?.ok) {
        onDone?.(result.data);
        return true;
      }
      setError(result?.error?.message ?? 'Setup could not be saved. Try again.');
    } catch (failure) {
      setError(failure?.message ?? 'Setup could not be saved. Try again.');
    }
    setBusy(false);
    return false;
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
      await finishSetup();
    } catch (failure) {
      setError(failure?.message ?? 'Google sign-in could not be completed.');
      setBusy(false);
    }
  }

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden flex items-center justify-center">
        <section
          className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8"
          aria-labelledby="onboarding-title"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Step {step} of 2</p>
          <div className="mt-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
            {step === 1 ? <UserPlusIcon size={22} /> : <CloudIcon size={22} />}
          </div>

          {step === 1 ? (
            <>
              <h1 id="onboarding-title" className="mt-5 text-3xl font-medium tracking-tight">
                {trimmedName === '' ? 'Welcome to Zuri' : `Welcome, ${trimmedName}`}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted">
                Zuri needs a name to greet you with and a theme to wear. Both are saved on this
                computer and can be changed again from Settings.
              </p>

              <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); continueToAccount(); }}>
                <div>
                  <Input
                    label="Your name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      // The old refusal belongs to the old value, not the new one.
                      if (error !== '') setError('');
                    }}
                    placeholder="What should Zuri call you?"
                    autoComplete="given-name"
                    autoFocus
                    fullWidth
                  />
                  {trimmedName !== '' && (
                    <p className="mt-2 text-xs text-muted">
                      {trimmedName.length} of {NAME_MAX_LENGTH} characters
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Theme</p>
                  <div className="grid grid-cols-2 gap-3">
                    {THEMES.map((option) => (
                      <Button
                        key={option.id}
                        type="button"
                        variant={theme === option.id ? 'secondary' : 'ghost'}
                        aria-pressed={theme === option.id}
                        onPress={() => chooseTheme(option.id)}
                      >
                        {option.icon}
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {nameError !== '' && (
                  <p role="alert" className="text-sm text-danger">
                    {nameError}
                  </p>
                )}

                <Button type="submit" variant="primary" fullWidth>
                  Continue
                </Button>
              </form>
            </>
          ) : (
            <>
              <h1 id="onboarding-title" className="mt-5 text-3xl font-medium tracking-tight">
                Sign in to Zuri
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted">
                Your Zuri account holds your plan, your monthly allowance and your usage. Sign in
                with Google, or with an email and password if you made one.
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                No account yet? Choose "Create an account" below and you can start on the Starter
                plan. Signing in is optional: you can skip this and sign in later from Zuri Cloud
                in the sidebar.
              </p>

              <div className="mt-6">
                <GoogleSignInButton
                  clientId={googleClientId}
                  onCredential={(credential) => void signInWithGoogle(credential)}
                  onError={setError}
                />
              </div>

              <p className="mt-5 text-center text-xs uppercase tracking-wide text-muted">or</p>

              <CloudAuthForm
                mode={authMode}
                onModeChange={setAuthMode}
                onSignedIn={() => void finishSetup()}
                api={api}
              />

              {error !== '' && (
                <p role="alert" className="mt-4 text-sm text-danger">
                  {error}
                </p>
              )}

              {busy && <p className="mt-3 text-sm text-muted">Signing you in...</p>}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" isDisabled={busy} onPress={() => void finishSetup()}>
                  Skip for now
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => {
                    setError('');
                    setStep(1);
                  }}
                >
                  Back
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}