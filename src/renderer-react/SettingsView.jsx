import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Input } from './ui.jsx';
import SelectField from './SelectField.jsx';

const PROVIDERS = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
  ['moonshot', 'Kimi (Moonshot)'],
  ['zai', 'Z.ai (GLM)'],
];

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

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <header className="mb-6"><h1 className="text-3xl font-medium tracking-tight">Settings</h1><p className="mt-2 text-sm text-muted">Appearance, provider keys, desktop control, and the app allow-lists.</p></header>
        {status === 'loading' && <p className="text-sm text-muted">Reading settings...</p>}
        {status === 'error' && <p role="alert" className="text-sm text-danger">{message}</p>}
        {status === 'ready' && <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-5"><h2 className="mb-4 text-lg font-medium">Appearance</h2><div className="flex flex-wrap items-end gap-3"><SelectField label="Theme" value={current.theme === 'light' ? 'light' : 'dark'} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(value) => void savePatch({ theme: value }, `Theme is now ${value}.`)} /><p className="text-sm text-muted">The choice is restored after restart.</p></div></section>

          <section className="rounded-xl border border-border bg-surface p-5"><h2 className="mb-4 text-lg font-medium">Model and overlay</h2><Input label="Default model" value={String(current.model ?? 'gpt-4o')} isReadOnly /><Checkbox className="mt-4" isSelected={current.overlayEnabled === true} isDisabled={busy} onChange={(checked) => void savePatch({ overlayEnabled: checked }, checked ? 'Assistant overlay enabled.' : 'Assistant overlay disabled.')}>Assistant overlay</Checkbox></section>

          <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2"><h2 className="mb-2 text-lg font-medium">Providers and keys</h2><p className="mb-4 text-sm text-muted">Keys are stored by the main process. The renderer only knows whether one exists.</p><form onSubmit={submitKey} className="flex flex-wrap items-end gap-3"><SelectField label="Provider" value={provider} options={PROVIDERS.map(([value, label]) => ({ value, label }))} onChange={(value) => { setProvider(value); void refreshKeyStatus(value); }} /><Input type="password" label="API key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste your key" autoComplete="off" className="min-w-64 flex-1" /><Button type="submit" variant="primary" isDisabled={busy}>Save key</Button><Button type="button" variant="danger" onPress={() => void removeKey()} isDisabled={busy || keyState !== 'saved'}>Remove key</Button><Chip color={keyState === 'saved' ? 'primary' : 'default'}>{keyState === 'saved' ? 'Key saved' : keyState === 'checking' ? 'Checking...' : keyState === 'error' ? 'Status unavailable' : 'No key saved'}</Chip></form></section>

          <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-medium">Allowed apps and sites</h2><p className="mt-1 text-sm text-muted">Act mode can only open entries listed here. Empty lists deny by default.</p></div><Button variant="ghost" onPress={() => void openDataFolder()}>Open data folder</Button></div><form onSubmit={addAllowed} className="mb-4 flex flex-wrap items-end gap-2"><SelectField label="Allow-list type" value={allowKind} options={[{ value: 'apps', label: 'App' }, { value: 'urls', label: 'Site' }]} onChange={setAllowKind} className="min-w-32" /><Input value={allowValue} onChange={(event) => setAllowValue(event.target.value)} placeholder={allowKind === 'apps' ? 'notepad.exe' : 'https://example.com'} aria-label={allowKind === 'apps' ? 'App name' : 'Site URL'} className="min-w-64 flex-1" /><Button type="submit" variant="secondary">Add</Button></form><div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-sm font-medium">Apps</p>{listFor('apps').length === 0 ? <p className="text-sm text-muted">No apps allowed.</p> : <ul className="flex flex-col gap-2">{listFor('apps').map((value) => <li key={value} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"><span className="truncate">{value}</span><Button size="sm" variant="ghost" onPress={() => void removeAllowed('apps', value)}>Remove</Button></li>)}</ul>}</div><div><p className="mb-2 text-sm font-medium">Sites</p>{listFor('urls').length === 0 ? <p className="text-sm text-muted">No sites allowed.</p> : <ul className="flex flex-col gap-2">{listFor('urls').map((value) => <li key={value} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"><span className="truncate">{value}</span><Button size="sm" variant="ghost" onPress={() => void removeAllowed('urls', value)}>Remove</Button></li>)}</ul>}</div></div></section>
        </div>}
        {message && status === 'ready' && <p role="status" className="mt-5 text-sm text-muted">{message}</p>}
      </div>
    </main>
  );
}
