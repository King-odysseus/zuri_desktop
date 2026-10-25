import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Input, Textarea } from './ui.jsx';
import SelectField from './SelectField.jsx';

const PROVIDERS = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
  ['moonshot', 'Kimi (Moonshot)'],
  ['zai', 'Z.ai (GLM)'],
];

/**
 * The same catalogue the cloud sells, so a person meets one product name (Zuri
 * Flash) instead of a supplier model id (deepseek-flash).
 *
 * Each row still carries the real supplier id, because that is what the provider
 * API is asked for and what providers/chat.js checks the saved model against. The
 * provider travels with the model because a supplier id is only valid on its own
 * API, so choosing a model also chooses the key that pays for it.
 */
const ZURI_MODELS = [
  { provider: 'deepseek', model: 'deepseek-flash', name: 'Zuri Flash', note: 'Cheap and quick for everyday questions.' },
  { provider: 'moonshot', model: 'kimi-k3', name: 'Zuri Pro', note: 'Balanced, and good with long documents.' },
  { provider: 'zai', model: 'glm-5.3', name: 'Zuri Max', note: 'Strong general reasoning.' },
  { provider: 'openai', model: 'gpt-5.3-codex', name: 'Zuri Code', note: 'Code, scripts and technical work.' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', name: 'Zuri Reason', note: 'Careful step-by-step analysis.' },
  { provider: 'anthropic', model: 'claude-opus-5-5', name: 'Zuri Elite', note: 'The deepest answers, and the dearest.' },
];

/** The person-facing name of the provider whose key a model spends. */
function providerLabel(provider) {
  return PROVIDERS.find(([value]) => value === provider)?.[1] ?? provider;
}

// The ids match store.js ANSWER_STYLE_CHOICES, which refuses anything else; the
// labels are here because the renderer cannot import main-process code.
const ANSWER_STYLE_OPTIONS = {
  answerLength: [['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']],
  answerTone: [['neutral', 'Neutral'], ['professional', 'Professional'], ['friendly', 'Friendly'], ['direct', 'Direct']],
  answerDetail: [['simple', 'Simple'], ['standard', 'Standard'], ['expert', 'Expert']],
  answerLayout: [['auto', 'Automatic'], ['plain', 'Plain text'], ['structured', 'Structured']],
};

// Field, label and one line of help, in the order the card shows them.
const FIELD_LABELS = [
  ['answerLength', 'Length', 'How much each reply carries.'],
  ['answerTone', 'Tone', 'The voice it writes in.'],
  ['answerDetail', 'Explanation level', 'Who the answer is pitched at.'],
  ['answerLayout', 'Layout', 'Whether replies use headings, lists and tables.'],
];

const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 2000;

const KEY_STATE_LABELS = {
  checking: 'Checking...',
  saved: 'Key saved',
  missing: 'No key saved',
  unavailable: 'Status unavailable',
  error: 'Status unavailable',
};

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  // The tokens follow data-theme, but Flowbite utilities follow the .dark
  // class. Keep both in step so a theme saved here reaches the whole window.
  document.documentElement.classList.toggle('dark', next === 'dark');
  return next;
}

export default function SettingsView() {
  const api = typeof window !== 'undefined' ? window.zuri : undefined;
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState('openai');
  const [key, setKey] = useState('');
  const [keyState, setKeyState] = useState('checking');
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [allowKind, setAllowKind] = useState('apps');
  const [allowValue, setAllowValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [addin, setAddin] = useState({ supported: false, installed: false, running: false });
  const [addinBusy, setAddinBusy] = useState(false);

  async function load() {
    if (typeof api?.settings?.get !== 'function') {
      setStatus('error');
      setMessage('Settings are only available when this page runs inside the Zuri app.');
      return;
    }
    try {
      const result = await api.settings.get();
      if (!result?.ok) {
        setStatus('error');
        setMessage(result?.error?.message ?? 'Settings could not be read.');
        return;
      }
      const next = result.data ?? {};
      setSettings(next);
      applyTheme(next.theme);
      setStatus('ready');
      await refreshKeyStatus(provider);
      await refreshAddinStatus();
    } catch (error) {
      setStatus('error');
      setMessage(error?.message ?? 'Settings could not be read.');
    }
  }

  useEffect(() => {
    void load();
    // The bridge is stable for the lifetime of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshKeyStatus(nextProvider) {
    if (typeof api?.settings?.keyStatus !== 'function') {
      setKeyState('unavailable');
      return;
    }
    setKeyState('checking');
    const result = await api.settings.keyStatus({ provider: nextProvider });
    setKeyState(result?.ok && result.data?.hasKey === true ? 'saved' : result?.ok ? 'missing' : 'error');
  }

  async function refreshAddinStatus() {
    if (typeof api?.settings?.addinStatus !== 'function') return;
    const result = await api.settings.addinStatus();
    if (result?.ok && result.data) setAddin(result.data);
  }

  async function installWordAddin() {
    if (typeof api?.settings?.addinInstall !== 'function') return;
    setAddinBusy(true);
    try {
      const result = await api.settings.addinInstall();
      if (!result?.ok) setMessage(result?.error?.message ?? 'The Word add-in could not be installed.');
      else {
        setAddin(result.data ?? {});
        setMessage('Word add-in installed for this Windows user. Restart Word if it is already open.');
      }
    } catch (error) {
      setMessage(error?.message ?? 'The Word add-in could not be installed.');
    } finally {
      setAddinBusy(false);
    }
  }

  async function removeWordAddin() {
    if (typeof api?.settings?.addinRemove !== 'function') return;
    setAddinBusy(true);
    try {
      const result = await api.settings.addinRemove();
      if (!result?.ok) setMessage(result?.error?.message ?? 'The Word add-in could not be removed.');
      else {
        setAddin(result.data ?? {});
        setMessage('Word add-in removed from this Windows user.');
      }
    } catch (error) {
      setMessage(error?.message ?? 'The Word add-in could not be removed.');
    } finally {
      setAddinBusy(false);
    }
  }

  async function savePatch(patch, successMessage) {
    if (typeof api?.settings?.save !== 'function') {
      setMessage('Settings can only be saved inside Zuri.');
      return false;
    }
    setBusy(true);
    try {
      const result = await api.settings.save(patch);
      if (!result?.ok) {
        setMessage(result?.error?.message ?? 'The change was not saved.');
        return false;
      }
      setSettings((current) => ({ ...(current ?? {}), ...(result.data ?? patch) }));
      if (Object.hasOwn(patch, 'theme')) applyTheme(patch.theme);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error?.message ?? 'The change was not saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitKey(event) {
    event.preventDefault();
    const typed = key.trim();
    setKey('');
    if (typed === '') {
      setMessage('Paste a key first.');
      return;
    }
    if (typeof api?.settings?.setKey !== 'function') {
      setMessage('Keys can only be saved inside Zuri.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.settings.setKey({ provider, key: typed });
      if (!result?.ok) {
        setMessage(result?.error?.message ?? 'The key was not saved.');
        return;
      }
      setKeyState(result.data?.hasKey === true ? 'saved' : 'missing');
      setMessage('Provider key saved.');
    } catch (error) {
      setMessage(error?.message ?? 'The key was not saved.');
      await refreshKeyStatus(provider);
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (typeof api?.settings?.clearKey !== 'function') return;
    setBusy(true);
    try {
      const result = await api.settings.clearKey({ provider });
      if (!result?.ok) {
        setMessage(result?.error?.message ?? 'The key was not removed.');
        return;
      }
      setKeyState('missing');
      setMessage('Provider key removed.');
    } catch (error) {
      setMessage(error?.message ?? 'The key was not removed.');
      await refreshKeyStatus(provider);
    } finally {
      setBusy(false);
    }
  }

  function listFor(kind) {
    return Array.isArray(settings?.[kind === 'apps' ? 'allowedApps' : 'allowedUrls'])
      ? settings[kind === 'apps' ? 'allowedApps' : 'allowedUrls']
      : [];
  }

  async function addAllowed(event) {
    event.preventDefault();
    const value = allowValue.trim();
    if (value === '') return;
    const field = allowKind === 'apps' ? 'allowedApps' : 'allowedUrls';
    const values = [...new Set([...listFor(allowKind), value])];
    const saved = await savePatch({ [field]: values }, `${allowKind === 'apps' ? 'App' : 'Site'} added.`);
    if (saved) setAllowValue('');
  }

  async function removeAllowed(kind, value) {
    const field = kind === 'apps' ? 'allowedApps' : 'allowedUrls';
    await savePatch({ [field]: listFor(kind).filter((entry) => entry !== value) }, 'Allow-list updated.');
  }

  async function openDataFolder() {
    const result = await api?.settings?.openDataFolder?.();
    setMessage(result?.ok ? 'Opened the Zuri data folder.' : result?.error?.message ?? 'The data folder could not be opened.');
  }

  const current = settings ?? {};

  // What the picker shows. A model saved before this list existed, or one set
  // elsewhere, keeps its own row rather than being displayed under a Zuri name
  // that is not what would be sent, which would misreport the active model.
  const savedModel = typeof current.model === 'string' ? current.model : '';
  const zuriModel = ZURI_MODELS.find((entry) => entry.model === savedModel) ?? null;
  const modelOptions = [
    ...ZURI_MODELS.map((entry) => ({ value: entry.model, label: entry.name })),
    ...(zuriModel === null && savedModel !== '' ? [{ value: savedModel, label: `${savedModel} (current)` }] : []),
  ];

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header>
          <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-muted">Appearance, provider keys, and what Zuri is allowed to open.</p>
        </header>

        {status === 'loading' && <p className="text-sm text-muted">Reading settings...</p>}
        {status === 'error' && <p role="alert" className="text-sm text-danger">{message}</p>}
        {status === 'ready' && message !== '' && <p role="status" className="text-sm text-muted">{message}</p>}

        {status === 'ready' && <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">Appearance</h2>
            <p className="mt-1 text-sm text-muted">Pick how Zuri looks. Applied straight away.</p>
            <div className="mt-4">
              <SelectField label="Theme" value={current.theme === 'light' ? 'light' : 'dark'} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(value) => void savePatch({ theme: value }, `Theme is now ${value}.`)} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">Model and overlay</h2>
            <p className="mt-1 text-sm text-muted">Choose the Zuri model that answers your chats. It is billed to your Zuri plan, so it needs no key of your own.</p>
            <div className="mt-4">
              <SelectField
                label="Model"
                value={zuriModel?.model ?? savedModel}
                options={modelOptions}
                onChange={(value) => {
                  const picked = ZURI_MODELS.find((entry) => entry.model === value);
                  // Saved together: a supplier id is only valid on its own API,
                  // so the model and the key that pays for it never drift apart.
                  if (picked === undefined) void savePatch({ model: value }, `Model set to ${value}.`);
                  else void savePatch({ provider: picked.provider, model: picked.model }, `Model set to ${picked.name}.`);
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              {zuriModel === null
                ? 'This model was chosen outside the Zuri list, so it is shown by its provider id.'
                : `${zuriModel.name}: ${zuriModel.note} Billed to your Zuri plan.`}
            </p>
            <p className="mt-2 text-xs text-muted">Your selected provider key is stored only on this computer. Cloud model usage and allowance are separate from local provider usage.</p>
            <Checkbox className="mt-4" isSelected={current.overlayEnabled === true} isDisabled={busy} onChange={(checked) => void savePatch({ overlayEnabled: checked }, checked ? 'Assistant overlay enabled.' : 'Assistant overlay disabled.')}>Assistant overlay</Checkbox>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="text-lg font-medium">How Zuri answers</h2>
            <p className="mt-1 text-sm text-muted">Every reply follows these choices, whichever model is answering.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FIELD_LABELS.map(([field, label, hint]) => (
                <div key={field}>
                  <SelectField
                    label={label}
                    value={String(current[field] ?? ANSWER_STYLE_OPTIONS[field][0][0])}
                    options={ANSWER_STYLE_OPTIONS[field].map(([value, optionLabel]) => ({ value, label: optionLabel }))}
                    onChange={(value) => void savePatch({ [field]: value }, `${label} set to ${value}.`)}
                  />
                  <p className="mt-1 text-xs text-muted">{hint}</p>
                </div>
              ))}
            </div>
            <Textarea
              className="mt-4"
              label="Standing instructions (optional)"
              rows={3}
              maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
              value={current.customInstructions ?? ''}
              onChange={(event) => setSettings((value) => ({ ...(value ?? {}), customInstructions: event.target.value }))}
              onBlur={() => void savePatch({ customInstructions: String(current.customInstructions ?? '') }, 'Standing instructions saved.')}
              placeholder="For example: answer in British English, and always show the cost in naira."
            />
            <p className="mt-1 text-xs text-muted">Added to every request. These win over the four choices above when the two disagree.</p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">Zuri Cloud connection</h2>
            <p className="mt-1 text-sm text-muted">Choose the Railway server used for Google sign-in, usage and subscriptions.</p>
            <Input className="mt-4" label="Cloud server URL" value={current.cloudUrl ?? ''} onChange={(event) => setSettings((value) => ({ ...(value ?? {}), cloudUrl: event.target.value }))} onBlur={() => void savePatch({ cloudUrl: String(current.cloudUrl ?? '').trim() }, 'Cloud server URL saved.')} placeholder="https://your-cloud-service.up.railway.app" />
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="text-lg font-medium">Provider key (optional)</h2>
            <p className="mt-1 text-sm text-muted">You do not need a key to chat: replies are billed to your Zuri plan through the account you signed in with. A key is only used by the Word add-in, which talks to a provider directly. Keys are stored on this computer and Zuri only knows whether one is saved.</p>
            <p className="mt-1 text-sm text-muted">Your messages, and the text of any file you attach, are sent to the provider you pick to write replies. Some providers are outside Nigeria. AI can be wrong, so check anything important. Read the privacy and terms notices at the Zuri Cloud site (/privacy and /terms).</p>
            <p role="note" className="mt-3 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-sm text-muted">
              Your messages are sent to the AI company behind the model you use, so it can write a reply. Some of these
              companies operate outside Nigeria, including in China and the United States, and handle data under their own
              policies. Do not send passwords, card details, ID numbers or confidential information you may not share.
              AI can be wrong: check anything important. Your chats, tasks and files stay on this computer.
            </p>
            <form onSubmit={submitKey} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <SelectField label="Provider" value={provider} options={PROVIDERS.map(([value, label]) => ({ value, label }))} onChange={(value) => { setProvider(value); void refreshKeyStatus(value); }} />
                <Chip className="mb-2" color={keyState === 'saved' ? 'primary' : 'default'}>{KEY_STATE_LABELS[keyState] ?? 'Status unavailable'}</Chip>
                <Input type="password" label="API key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste your key" autoComplete="off" className="min-w-64 flex-1" />
                <Button type="submit" variant="primary" isDisabled={busy}>Save key</Button>
              </div>
              <div>
                <Button type="button" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeKey()} isDisabled={busy || keyState !== 'saved'}>Remove key</Button>
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
            <h2 className="text-lg font-medium">Microsoft Word add-in</h2>
            <p className="mt-1 text-sm text-muted">Install Zuri's local Word task pane for this Windows user. It needs Zuri running to answer requests.</p>
            {!addin.supported && <p className="mt-3 text-sm text-muted">The Word add-in is available on Windows only.</p>}
            {addin.supported && <div className="mt-4 flex flex-wrap items-center gap-3">
              <Chip color={addin.installed ? 'primary' : 'default'}>{addin.installed ? 'Installed' : 'Not installed'}</Chip>
              <Button variant="secondary" onPress={() => void installWordAddin()} isDisabled={addinBusy || addin.installed}>Install for Word</Button>
              <Button variant="ghost" className="zuri-danger-quiet" onPress={() => void removeWordAddin()} isDisabled={addinBusy || !addin.installed}>Remove add-in</Button>
            </div>}
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">Allowed apps and sites</h2>
                <p className="mt-1 text-sm text-muted">Act mode can only open apps and sites listed here. Empty lists block everything.</p>
              </div>
              <Button variant="ghost" onPress={() => void openDataFolder()}>Open data folder</Button>
            </div>
            <form onSubmit={addAllowed} className="mt-4 flex flex-wrap items-end gap-2">
              <SelectField label="Type" value={allowKind} options={[{ value: 'apps', label: 'App' }, { value: 'urls', label: 'Site' }]} onChange={setAllowKind} className="min-w-32" />
              <Input label="App or site" value={allowValue} onChange={(event) => setAllowValue(event.target.value)} placeholder={allowKind === 'apps' ? 'notepad.exe' : 'https://example.com'} className="min-w-64 flex-1" />
              <Button type="submit" variant="secondary">Add</Button>
            </form>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Apps</p>
                {listFor('apps').length === 0 ? <p className="text-sm text-muted">No apps added yet.</p> : <ul className="flex flex-col gap-2">{listFor('apps').map((value) => <li key={value} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{value}</span><Button size="sm" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeAllowed('apps', value)}>Remove</Button></li>)}</ul>}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Sites</p>
                {listFor('urls').length === 0 ? <p className="text-sm text-muted">No sites added yet.</p> : <ul className="flex flex-col gap-2">{listFor('urls').map((value) => <li key={value} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{value}</span><Button size="sm" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeAllowed('urls', value)}>Remove</Button></li>)}</ul>}
              </div>
            </div>
          </section>
        </div>}
      </div>
    </main>
  );
}
