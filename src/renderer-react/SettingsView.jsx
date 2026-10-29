import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Input, Textarea } from './ui.jsx';
import SelectField from './SelectField.jsx';
// The catalogue lives in its own module because the composer's model chip offers
// the same six names, and two copies of a supplier id would drift apart.
import { ZURI_MODELS } from './zuriModels.js';

const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 2000;

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
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [allowKind, setAllowKind] = useState('apps');
  const [allowValue, setAllowValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [addin, setAddin] = useState({ supported: false, installed: false, running: false });
  const [addinBusy, setAddinBusy] = useState(false);
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState('');

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
      await refreshAddinStatus();
      const account = await api.cloud?.account?.();
      if (account?.ok) {
        const accountUser = account.data?.user ?? null;
        setUser(accountUser);
        setDisplayName(accountUser?.displayName ?? '');
      }
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

  async function refreshAddinStatus() {
    if (typeof api?.settings?.addinStatus !== 'function') return;
    const result = await api.settings.addinStatus();
    if (result?.ok && result.data) setAddin(result.data);
  }

  async function installOfficeAddin() {
    if (typeof api?.settings?.addinInstall !== 'function') return;
    setAddinBusy(true);
    try {
      const result = await api.settings.addinInstall();
      if (!result?.ok) setMessage(result?.error?.message ?? 'The Office add-in could not be installed.');
      else {
        setAddin(result.data ?? {});
        setMessage('Office add-in installed for this Windows user. Restart Word, Excel or PowerPoint if it is already open.');
      }
    } catch (error) {
      setMessage(error?.message ?? 'The Office add-in could not be installed.');
    } finally {
      setAddinBusy(false);
    }
  }

  async function removeOfficeAddin() {
    if (typeof api?.settings?.addinRemove !== 'function') return;
    setAddinBusy(true);
    try {
      const result = await api.settings.addinRemove();
      if (!result?.ok) setMessage(result?.error?.message ?? 'The Office add-in could not be removed.');
      else {
        setAddin(result.data ?? {});
        setMessage('Office add-in removed from this Windows user.');
      }
    } catch (error) {
      setMessage(error?.message ?? 'The Office add-in could not be removed.');
    } finally {
      setAddinBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await api?.cloud?.signOut?.();
    // App listens for this and returns to the sign-in screen.
    window.dispatchEvent(new Event('zuri:signed-out'));
  }

  async function saveAccountName(event) {
    event.preventDefault();
    const nextName = displayName.trim();
    if (nextName.length > 60) {
      setMessage('Use 60 characters or fewer for your name.');
      return;
    }
    setBusy(true);
    try {
      const result = await api?.cloud?.updateAccount?.({ displayName: nextName });
      if (!result?.ok) {
        setMessage(result?.error?.message ?? 'The name could not be saved.');
        return;
      }
      setUser((current) => ({ ...(current ?? {}), ...(result.data?.user ?? {}), displayName: nextName }));
      setMessage('Name saved.');
    } catch (error) {
      setMessage(error?.message ?? 'The name could not be saved.');
    } finally {
      setBusy(false);
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

  // One centred column of hairline-separated rows, like a plain account page.
  const row = 'flex flex-wrap items-center justify-between gap-3 border-t border-border py-5';
  const heading = 'text-base font-medium';
  const helper = 'mt-1 text-sm text-muted';

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="max-w-2xl pb-8">
          <header className="pb-6">
            <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted">Your account, how Zuri looks, and the Office add-in.</p>
          </header>

          {status === 'loading' && <p className="text-sm text-muted">Reading settings...</p>}
          {status === 'error' && <p role="alert" className="text-sm text-danger">{message}</p>}
          {status === 'ready' && message !== '' && <p role="status" className="pb-4 text-sm text-muted">{message}</p>}

          {status === 'ready' && <div>
            <section className={row}>
              <div>
                <h2 className={heading}>Account</h2>
                <p className={helper}>{user ? `Signed in as ${user.displayName || user.email}` : 'Signed in to Zuri Cloud.'}</p>
                <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={saveAccountName}>
                  <Input label="Your name" value={displayName} maxLength={60} onChange={(event) => setDisplayName(event.target.value)} placeholder="What should Zuri call you?" />
                  <Button type="submit" variant="secondary" isDisabled={busy}>{busy ? 'Saving...' : 'Save name'}</Button>
                </form>
              </div>
              <Button variant="ghost" onPress={() => void signOut()} isDisabled={busy}>Sign out</Button>
            </section>

            <section className="border-t border-border py-5">
              <h2 className={heading}>Appearance</h2>
              <p className={helper}>Pick how Zuri looks. Applied straight away.</p>
              <div className="mt-3">
                <SelectField label="Theme" value={current.theme === 'light' ? 'light' : 'dark'} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(value) => void savePatch({ theme: value }, `Theme is now ${value}.`)} />
              </div>
            </section>

            <section className="border-t border-border py-5">
              <h2 className={heading}>Model</h2>
              <p className={helper}>The Zuri model that answers your chats. It is billed to your Zuri plan.</p>
              <div className="mt-3">
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
              <Checkbox className="mt-4" isSelected={current.overlayEnabled === true} isDisabled={busy} onChange={(checked) => void savePatch({ overlayEnabled: checked }, checked ? 'Assistant overlay enabled.' : 'Assistant overlay disabled.')}>Assistant overlay</Checkbox>
            </section>

            <section className="border-t border-border py-5">
              <h2 className={heading}>Standing instructions</h2>
              <Textarea
                className="mt-3"
                label="Added to every request (optional)"
                rows={3}
                maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
                value={current.customInstructions ?? ''}
                onChange={(event) => setSettings((value) => ({ ...(value ?? {}), customInstructions: event.target.value }))}
                onBlur={() => void savePatch({ customInstructions: String(current.customInstructions ?? '') }, 'Standing instructions saved.')}
                placeholder="For example: answer in British English, and always show the cost in naira."
              />
            </section>

            <section className="border-t border-border py-5">
              <h2 className={heading}>Office add-in</h2>
              <p className={helper}>Adds Zuri to Word, PowerPoint and Excel for this Windows user. It needs Zuri running to answer requests.</p>
              {!addin.supported && <p className="mt-3 text-sm text-muted">The Office add-in is available on Windows only.</p>}
              {addin.supported && <div className="mt-3 flex flex-wrap items-center gap-3">
                <Chip color={addin.installed ? 'primary' : 'default'}>{addin.installed ? 'Installed' : 'Not installed'}</Chip>
                <Button variant="secondary" onPress={() => void installOfficeAddin()} isDisabled={addinBusy || addin.installed}>Install for Word, PowerPoint and Excel</Button>
                <Button variant="ghost" className="zuri-danger-quiet" onPress={() => void removeOfficeAddin()} isDisabled={addinBusy || !addin.installed}>Remove add-in</Button>
              </div>}
            </section>

            <details className="border-t border-border py-5">
              <summary className={`cursor-pointer ${heading}`}>Advanced: apps and sites Act mode may open</summary>
              <p className={helper}>Act mode can only open apps and sites listed here. Empty lists block everything.</p>
              <form onSubmit={addAllowed} className="mt-4 flex flex-wrap items-end gap-2">
                <SelectField label="Type" value={allowKind} options={[{ value: 'apps', label: 'App' }, { value: 'urls', label: 'Site' }]} onChange={setAllowKind} className="min-w-32" />
                <Input label="App or site" value={allowValue} onChange={(event) => setAllowValue(event.target.value)} placeholder={allowKind === 'apps' ? 'notepad.exe' : 'https://example.com'} className="min-w-48 flex-1" />
                <Button type="submit" variant="secondary">Add</Button>
              </form>
              <div className="mt-4 flex flex-col gap-4">
                <div>
                  <p className="mb-2 text-sm font-medium">Apps</p>
                  {listFor('apps').length === 0 ? <p className="text-sm text-muted">No apps added yet.</p> : <ul className="flex flex-col gap-2">{listFor('apps').map((value) => <li key={value} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{value}</span><Button size="sm" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeAllowed('apps', value)}>Remove</Button></li>)}</ul>}
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Sites</p>
                  {listFor('urls').length === 0 ? <p className="text-sm text-muted">No sites added yet.</p> : <ul className="flex flex-col gap-2">{listFor('urls').map((value) => <li key={value} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{value}</span><Button size="sm" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeAllowed('urls', value)}>Remove</Button></li>)}</ul>}
                </div>
              </div>
            </details>
          </div>}
        </div>
      </div>
    </main>
  );
}
