import { useState } from 'react';
import { Button, Input, Label, Select } from './ui.jsx';
import { AgentIcon, MoonIcon, SunIcon, UserPlusIcon } from './Icons.jsx';

// Same ids and labels as PROVIDERS in src/main/secrets.js. That module opens the
// secrets file with node:fs, so the renderer cannot import it; SettingsView keeps
// the same copy for the same reason.
const PROVIDERS = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
  ['moonshot', 'Kimi (Moonshot)'],
  ['zai', 'Z.ai (GLM)'],
];

// DEFAULT_PROVIDER in secrets.js. Named separately so reordering the list above
// cannot quietly change which provider a key is filed under.
const DEFAULT_PROVIDER = 'openai';

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
 * First run, in two screens: who you are and which theme you want, then the
 * provider key. The name and theme are required, the key is not, and main stores
 * them through a different channel depending on whether a key came with them.
 *
 * @param {{ onDone?: (saved: any) => void }} props
 */
export default function OnboardingView({ onDone }) {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState(currentTheme);
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const trimmedName = name.trim();
  const problem = nameProblem(trimmedName);
  // Main's refusal wins; before one arrives, the field explains itself as soon as
  // something has been typed, so an empty box is not shouted at.
  const nameError = error || (trimmedName === '' ? '' : problem);
  const providerLabel = PROVIDERS.find(([id]) => id === provider)?.[1] ?? provider;

  function chooseTheme(next) {
    setTheme(next);
    // This card is the whole window, so the choice has to be visible before it is
    // stored: paint the tokens now and save them with the rest on Continue.
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
  }

  function continueToKey() {
    if (problem !== '') {
      setError(problem);
      return;
    }
    setError('');
    setStep(2);
  }

  async function finish(event) {
    event.preventDefault();
    if (busy) return;
    if (typeof api?.onboarding?.complete !== 'function') {
      setError('Setup can only be finished inside the Zuri app.');
      return;
    }
    if (key.trim() === '') {
      setError('Paste a provider key, or choose "Skip for now" and add it in Settings when you have it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // One channel for both answers: main writes the name and theme, then hands
      // the key to secrets.js. Nothing sends the key back.
      const result = await api.onboarding.complete({
        name: trimmedName,
        theme,
        provider,
        key: key.trim(),
      });
      if (result?.ok) {
        onDone?.(result.data);
        return;
      }
      setError(result?.error?.message ?? 'Setup could not be saved. Try again.');
    } catch (failure) {
      setError(failure?.message ?? 'Setup could not be saved. Try again.');
    }
    setBusy(false);
  }

  async function skip() {
    if (busy) return;
    if (typeof api?.settings?.save !== 'function') {
      setError('Setup can only be finished inside the Zuri app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // onboarding.complete always passes its key to secrets.js, which refuses an
      // empty one, so skipping saves the two answers that are actually ready and
      // leaves the key for Settings.
      const result = await api.settings.save({ name: trimmedName, theme });
      if (result?.ok) {
        onDone?.(result.data);
        return;
      }
      setError(result?.error?.message ?? 'Setup could not be saved. Try again.');
    } catch (failure) {
      setError(failure?.message ?? 'Setup could not be saved. Try again.');
    }
    setBusy(false);
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
            {step === 1 ? <UserPlusIcon size={22} /> : <AgentIcon size={22} />}
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

              <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); continueToKey(); }}>
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
                Connect a model
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted">
                Zuri writes its replies through a model provider. Paste a key for one of these
                services, or skip and add it from Settings when you have it.
                Your messages go to the company behind the model to write replies, and some of
                these companies are outside Nigeria. AI can be wrong, so check anything important.
              </p>

              <form className="mt-6 flex flex-col gap-4" onSubmit={finish}>
                <div>
                  <Label htmlFor="onboarding-provider" className="zuri-field-label mb-2 block text-sm font-medium text-foreground">
                    Provider
                  </Label>
                  <Select
                    id="onboarding-provider"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                  >
                    {PROVIDERS.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Input
                    type="password"
                    label={`${providerLabel} API key`}
                    value={key}
                    onChange={(event) => {
                      setKey(event.target.value);
                      if (error !== '') setError('');
                    }}
                    placeholder="Paste the key from your provider dashboard"
                    autoComplete="off"
                    spellCheck={false}
                    fullWidth
                  />
                  <p className="mt-2 text-xs leading-5 text-muted">
                    The key is stored on this computer only, in a file only your user account can
                    read, and Zuri uses it to call {providerLabel} from this app.
                  </p>
                </div>

                {error !== '' && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" variant="primary" isDisabled={busy}>
                    {busy ? 'Saving...' : 'Finish setup'}
                  </Button>
                  <Button type="button" variant="secondary" isDisabled={busy} onPress={() => void skip()}>
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
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
