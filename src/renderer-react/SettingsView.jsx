import { useEffect, useState } from 'react';
import { Button, Chip, Input, Textarea } from './ui.jsx';
import SelectField from './SelectField.jsx';
// The catalogue lives in its own module because the composer's model chip offers
// the same six names, and two copies of a supplier id would drift apart.
import { ZURI_MODELS } from './zuriModels.js';
import {
  BellIcon,
  BrainIcon,
  ChevronDownIcon,
  CloseIcon,
  CodeIcon,
  FileIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
  SunIcon,
  UserIcon,
} from './Icons.jsx';

const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 2000;
const ABOUT_MAX_LENGTH = 200;
const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;

/*
 * The settings rail, in the order ChatGPT lists its own: who you are first, then
 * how Zuri looks and answers. Splitting the old single page this way is what lets
 * the panel take the whole side of the window instead of one long scroll.
 */
const SECTIONS = [
  {
    group: 'Personal',
    items: [
      { key: 'general', label: 'General', Icon: SettingsIcon },
      { key: 'notifications', label: 'Notifications', Icon: BellIcon },
      { key: 'profile', label: 'Profile', Icon: UserIcon },
      { key: 'account', label: 'Account', Icon: ShieldIcon },
      { key: 'appearance', label: 'Appearance', Icon: SunIcon },
    ],
  },
  {
    group: 'Zuri',
    items: [
      { key: 'model', label: 'Model', Icon: SparkIcon },
      { key: 'instructions', label: 'Standing instructions', Icon: BrainIcon },
      { key: 'addin', label: 'Office add-in', Icon: FileIcon },
      { key: 'advanced', label: 'Advanced', Icon: CodeIcon },
    ],
  },
];

const SECTION_COPY = {
  general: ['General', 'How Zuri looks and behaves on this device.'],
  notifications: ['Notifications', 'Choose how Zuri tells you when something happens.'],
  profile: ['Profile', 'The name Zuri calls you and the few lines it knows about you.'],
  account: ['Account', 'Who is signed in, what plan pays for it, and how old the account is.'],
  appearance: ['Appearance', 'The colours of the window. The change applies straight away.'],
  model: ['Model', 'The Zuri model that answers your chats. Your plan is billed for it.'],
  instructions: ['Standing instructions', 'Words added to every request, in every chat.'],
  addin: ['Office add-in', 'Zuri inside Word, PowerPoint and Excel.'],
  advanced: ['Advanced', 'The apps and sites Act mode may open, and nothing else.'],
};

/* Delivery channels, one per category. Push is a desktop alert, email goes to
   the address on the account, and off means never. */
const DELIVERY_OPTIONS = [
  { value: 'push', label: 'Push' },
  { value: 'email', label: 'Email' },
  { value: 'both', label: 'Push, Email' },
  { value: 'off', label: 'Off' },
];

const NOTIFICATION_ROWS = [
  { key: 'replies', label: 'Replies', description: 'Told when a long answer is ready and you have switched to another chat.' },
  { key: 'pictures', label: 'Pictures', description: 'Told when a picture has finished drawing.' },
  { key: 'reminders', label: 'Reminders', description: 'The alerts you set a time for.' },
  { key: 'tasks', label: 'Tasks', description: 'When a task you follow is finished or needs an answer.' },
  { key: 'automations', label: 'Automations', description: 'When a scheduled run finishes, with its result.' },
  { key: 'news', label: 'Product news', description: 'New tools and changes to Zuri.' },
];

const NOTIFICATION_DEFAULTS = {
  replies: 'push',
  pictures: 'push',
  reminders: 'push',
  tasks: 'off',
  automations: 'push',
  news: 'email',
};

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  // The tokens follow data-theme, but Flowbite utilities follow the .dark
  // class. Keep both in step so a theme saved here reaches the whole window.
  document.documentElement.classList.toggle('dark', next === 'dark');
  return next;
}

/** The letter shown in the round avatar when there is no picture. */
function initialFor(name, email) {
  const source = String(name || email || 'Z').trim();
  return source.charAt(0).toUpperCase() || 'Z';
}

function SettingsCard({ children }) {
  return <div className="zuri-set-card">{children}</div>;
}

/** One hairline row: words on the left, the control that changes them on the right. */
function SettingsRow({ title, description, children }) {
  return (
    <div className="zuri-set-row">
      <div className="zuri-set-copy">
        <p className="zuri-set-title">{title}</p>
        {description && <p className="zuri-set-help">{description}</p>}
      </div>
      {children && <div className="zuri-set-control">{children}</div>}
    </div>
  );
}

/**
 * A single-choice control drawn as a radio, in ChatGPT's shape: the circle marks
 * the state and the whole row is the target, so the label is as tappable as the dot.
 */
function Choice({ name, label, description, checked, onPick }) {
  return (
    <label className={`zuri-choice${checked ? ' is-selected' : ''}`}>
      <input type="radio" name={name} className="zuri-radio" checked={checked} onChange={() => onPick()} />
      <span className="zuri-choice-copy">
        <span className="zuri-choice-label">{label}</span>
        {description && <span className="zuri-choice-help">{description}</span>}
      </span>
    </label>
  );
}

/** The small pill select ChatGPT uses for a per-row delivery choice. */
function DeliverySelect({ label, value, onChange }) {
  return (
    <span className="zuri-set-select">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {DELIVERY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDownIcon size={14} className="zuri-set-select-chevron" />
    </span>
  );
}

export default function SettingsView({ initialSection = 'general', onSectionChange, onClose }) {
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
  const [account, setAccount] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [about, setAbout] = useState('');
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');

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
      setUsername(typeof next.username === 'string' ? next.username : '');
      setAbout(typeof next.about === 'string' ? next.about : '');
      setStatus('ready');
      await refreshAddinStatus();
      const accountResult = await api.cloud?.account?.();
      if (accountResult?.ok) {
        const accountUser = accountResult.data?.user ?? null;
        setUser(accountUser);
        setAccount(accountResult.data ?? null);
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

  // The account menu can send a different section while the panel is already open.
  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

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

  /** Name, username and about you save together so one button keeps them in step. */
  async function saveProfile(event) {
    event.preventDefault();
    const nextName = displayName.trim();
    const nextUsername = username.trim().toLowerCase();
    if (nextName.length > 60) {
      setMessage('Use 60 characters or fewer for your name.');
      return;
    }
    if (nextUsername !== '' && !USERNAME_PATTERN.test(nextUsername)) {
      setMessage('A username is 3 to 30 letters, numbers, dots or underscores.');
      return;
    }
    setBusy(true);
    try {
      if (user !== null && nextName !== (user.displayName ?? '')) {
        const result = await api?.cloud?.updateAccount?.({ displayName: nextName });
        if (!result?.ok) {
          setMessage(result?.error?.message ?? 'The name could not be saved.');
          return;
        }
        setUser((current) => ({ ...(current ?? {}), ...(result.data?.user ?? {}), displayName: nextName }));
        // The account row in the sidebar shows this name, so tell it to re-read.
        window.dispatchEvent(new Event('zuri:account-changed'));
      }
      const saved = await savePatch(
        { name: nextName, username: nextUsername, about: about.trim() },
        'Profile saved.',
      );
      if (saved) {
        setDisplayName(nextName);
        setUsername(nextUsername);
      }
    } catch (error) {
      setMessage(error?.message ?? 'The profile could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const current = settings ?? {};
  const notify = { ...NOTIFICATION_DEFAULTS, ...(current.notify ?? {}) };
  const themeChoice = current.theme === 'light' ? 'light' : 'dark';
  const ageConfirmed = current.ageConfirmed === true;

  async function setNotification(key, value) {
    await savePatch({ notify: { ...notify, [key]: value } }, 'Notification choice saved.');
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

  // What the picker shows. A model saved before this list existed, or one set
  // elsewhere, keeps its own row rather than being displayed under a Zuri name
  // that is not what would be sent, which would misreport the active model.
  const savedModel = typeof current.model === 'string' ? current.model : '';
  const zuriModel = ZURI_MODELS.find((entry) => entry.model === savedModel) ?? null;
  const modelOptions = [
    ...ZURI_MODELS.map((entry) => ({ value: entry.model, label: entry.name })),
    ...(zuriModel === null && savedModel !== '' ? [{ value: savedModel, label: `${savedModel} (current)` }] : []),
  ];

  function chooseSection(key) {
    setSection(key);
    setQuery('');
    setMessage('');
    onSectionChange?.(key);
  }

  const search = query.trim().toLowerCase();
  const visibleGroups = SECTIONS
    .map((group) => ({ ...group, items: group.items.filter((item) => search === '' || item.label.toLowerCase().includes(search)) }))
    .filter((group) => group.items.length > 0);
  const [heading, subheading] = SECTION_COPY[section] ?? SECTION_COPY.general;
  const initials = initialFor(displayName, user?.email);

  return (
    <main className="zuri-settings" aria-label="Settings">
      <aside className="zuri-settings-rail">
        <div className="zuri-settings-rail-head">
          <h1 className="zuri-settings-rail-title">Settings</h1>
          {onClose && (
            <Button isIconOnly size="sm" variant="ghost" className="zuri-settings-close" aria-label="Close settings" title="Back to Zuri" onPress={onClose}>
              <CloseIcon size={16} />
            </Button>
          )}
        </div>

        <label className="zuri-settings-search">
          <SearchIcon size={15} className="zuri-settings-search-icon" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search settings"
          />
        </label>

        <nav className="zuri-settings-nav" aria-label="Settings sections">
          {visibleGroups.map((group) => (
            <div className="zuri-settings-nav-group" key={group.group}>
              <p className="zuri-settings-nav-label">{group.group}</p>
              {group.items.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`zuri-settings-nav-item${section === key ? ' is-active' : ''}`}
                  aria-current={section === key ? 'page' : undefined}
                  onClick={() => chooseSection(key)}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
          {visibleGroups.length === 0 && <p className="zuri-settings-nav-empty">Nothing matches that word.</p>}
        </nav>
      </aside>

      <section className="zuri-settings-body">
        <div className="zuri-settings-page">
          <header className="zuri-settings-page-head">
            <h2 className="zuri-settings-title">{heading}</h2>
            <p className="zuri-settings-sub">{subheading}</p>
          </header>

          {status === 'loading' && <p className="text-sm text-muted">Reading settings...</p>}
          {status === 'error' && <p role="alert" className="zuri-notice is-danger text-sm text-danger">{message}</p>}
          {status === 'ready' && message !== '' && <p role="status" className="zuri-settings-message">{message}</p>}

          {status === 'ready' && section === 'general' && (
            <>
              <SettingsCard>
                <SettingsRow title="Theme" description="Light for daytime, dark for the evening.">
                  <div className="zuri-choice-row">
                    <Choice name="theme" label="Light" checked={themeChoice === 'light'} onPick={() => void savePatch({ theme: 'light' }, 'Theme is now light.')} />
                    <Choice name="theme" label="Dark" checked={themeChoice === 'dark'} onPick={() => void savePatch({ theme: 'dark' }, 'Theme is now dark.')} />
                  </div>
                </SettingsRow>
                <SettingsRow title="Assistant overlay" description="A small Zuri window over your work. Ctrl Alt Space opens it from anywhere.">
                  <label className="zuri-switch">
                    <input
                      type="checkbox"
                      className="zuri-switch-input"
                      checked={current.overlayEnabled === true}
                      disabled={busy}
                      aria-label="Assistant overlay"
                      onChange={(event) => void savePatch(
                        { overlayEnabled: event.target.checked },
                        event.target.checked ? 'Assistant overlay enabled.' : 'Assistant overlay disabled.',
                      )}
                    />
                    <span className="zuri-switch-track" aria-hidden="true"><span className="zuri-switch-thumb" /></span>
                  </label>
                </SettingsRow>
              </SettingsCard>

              <SettingsCard>
                <SettingsRow
                  title="Account"
                  description={user ? `Signed in as ${user.displayName || user.email}` : 'Signed in to Zuri Cloud.'}
                >
                  <Button size="sm" variant="secondary" onPress={() => chooseSection('account')}>Manage</Button>
                </SettingsRow>
                <SettingsRow title="Where chats are kept" description="Chats, projects and reminders stay in Zuri's own folder on this computer.">
                  <Button size="sm" variant="secondary" onPress={() => void api?.settings?.openDataFolder?.()}>Open folder</Button>
                </SettingsRow>
              </SettingsCard>
            </>
          )}

          {status === 'ready' && section === 'appearance' && (
            <SettingsCard>
              <SettingsRow title="Theme" description="The change applies straight away and is remembered next time.">
                <div className="zuri-choice-row">
                  <Choice name="appearance-theme" label="Light" checked={themeChoice === 'light'} onPick={() => void savePatch({ theme: 'light' }, 'Theme is now light.')} />
                  <Choice name="appearance-theme" label="Dark" checked={themeChoice === 'dark'} onPick={() => void savePatch({ theme: 'dark' }, 'Theme is now dark.')} />
                </div>
              </SettingsRow>
            </SettingsCard>
          )}

          {status === 'ready' && section === 'notifications' && (
            <SettingsCard>
              {NOTIFICATION_ROWS.map((row) => (
                <SettingsRow key={row.key} title={row.label} description={row.description}>
                  <DeliverySelect label={`${row.label} delivery`} value={notify[row.key]} onChange={(value) => void setNotification(row.key, value)} />
                </SettingsRow>
              ))}
            </SettingsCard>
          )}

          {status === 'ready' && section === 'profile' && (
            <>
              <form onSubmit={saveProfile}>
                <SettingsCard>
                  <SettingsRow title="Picture" description="Zuri shows the first letter of your name.">
                    <span className="zuri-avatar zuri-avatar-lg" aria-hidden="true">{initials}</span>
                  </SettingsRow>
                  <SettingsRow title="Name" description="What Zuri calls you, here and in the account menu.">
                    <Input value={displayName} maxLength={60} aria-label="Name" onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" className="zuri-set-input" />
                  </SettingsRow>
                  <SettingsRow title="Username" description="A short handle, 3 to 30 letters, numbers, dots or underscores.">
                    <span className="zuri-set-prefix">
                      <span aria-hidden="true">@</span>
                      <Input value={username} maxLength={30} aria-label="Username" onChange={(event) => setUsername(event.target.value)} placeholder="yourname" className="zuri-set-input" />
                    </span>
                  </SettingsRow>
                  <SettingsRow title="About you" description="A line or two Zuri can keep in mind. Never shared with anyone.">
                    <Textarea value={about} rows={3} maxLength={ABOUT_MAX_LENGTH} aria-label="About you" onChange={(event) => setAbout(event.target.value)} placeholder="What you work on, and how you like answers." className="zuri-set-textarea" />
                  </SettingsRow>
                </SettingsCard>
                <div className="zuri-settings-actions">
                  <Button type="submit" size="sm" variant="primary" isDisabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
                </div>
              </form>

              <section className="zuri-settings-block">
                <h3 className="zuri-settings-block-title">Age</h3>
                <p className="zuri-settings-block-help">Zuri is for people 18 and older.</p>
                <div className="zuri-choice-stack" role="radiogroup" aria-label="Age">
                  <Choice
                    name="age"
                    label="18 or older"
                    description="You can use Zuri with no age limit on answers."
                    checked={ageConfirmed}
                    onPick={() => void savePatch({ ageConfirmed: true }, 'Age confirmed: 18 or older.')}
                  />
                  <Choice
                    name="age"
                    label="Under 18"
                    description="Zuri cannot be used by anyone under 18. Ask a parent or guardian for help."
                    checked={current.ageConfirmed === false}
                    onPick={() => void savePatch({ ageConfirmed: false }, 'Zuri is for people 18 and older. Your account stays signed in, but please stop using it.')}
                  />
                </div>
              </section>
            </>
          )}

          {status === 'ready' && section === 'account' && (
            <>
              <SettingsCard>
                <SettingsRow title="Name" description="Shown in the account menu.">
                  <span className="zuri-set-value">{displayName || user?.displayName || 'Not set'}</span>
                </SettingsRow>
                <SettingsRow title="Username" description="Your handle in Zuri.">
                  <span className="zuri-set-value">{username ? `@${username}` : 'Not set'}</span>
                </SettingsRow>
                <SettingsRow title="Email" description="The address you sign in with.">
                  <span className="zuri-set-value">{user?.email ?? 'Not signed in'}</span>
                </SettingsRow>
                <SettingsRow title="Plan" description="What pays for the answers.">
                  <span className="zuri-set-value">{account?.subscription?.planName ?? 'No paid plan'}</span>
                </SettingsRow>
                <SettingsRow title="Age" description={ageConfirmed ? 'Confirmed once on this account.' : 'Not confirmed yet.'}>
                  <span className="zuri-set-value">{ageConfirmed ? '18 or older' : 'Not confirmed'}</span>
                </SettingsRow>
              </SettingsCard>

              <SettingsCard>
                <SettingsRow title="Edit your details" description="Name, username and the note Zuri keeps about you.">
                  <Button size="sm" variant="secondary" onPress={() => chooseSection('profile')}>Edit</Button>
                </SettingsRow>
                <SettingsRow title="Sign out" description="Signing out returns this window to the sign-in screen.">
                  <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void signOut()}>Sign out</Button>
                </SettingsRow>
              </SettingsCard>

              <section className="zuri-settings-block">
                <h3 className="zuri-settings-block-title">Closing your account</h3>
                <p className="zuri-settings-block-help">Deleting an account removes every chat, project and picture on it for good. The app cannot do that on its own yet, so write to support@zuri.africa and it is done for you.</p>
              </section>
            </>
          )}

          {status === 'ready' && section === 'model' && (
            <SettingsCard>
              <SettingsRow title="Answer model" description="Every reply in every chat comes from this model.">
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
              </SettingsRow>
            </SettingsCard>
          )}

          {status === 'ready' && section === 'instructions' && (
            <SettingsCard>
              <SettingsRow title="Added to every request" description={`Up to ${CUSTOM_INSTRUCTIONS_MAX_LENGTH} characters. Left blank, Zuri answers in its own voice.`}>
                <Textarea
                  rows={4}
                  maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
                  aria-label="Standing instructions"
                  className="zuri-set-textarea"
                  value={current.customInstructions ?? ''}
                  onChange={(event) => setSettings((value) => ({ ...(value ?? {}), customInstructions: event.target.value }))}
                  onBlur={() => void savePatch({ customInstructions: String(current.customInstructions ?? '') }, 'Standing instructions saved.')}
                  placeholder="For example: answer in British English, and always show the cost in naira."
                />
              </SettingsRow>
            </SettingsCard>
          )}

          {status === 'ready' && section === 'addin' && (
            <SettingsCard>
              <SettingsRow title="Office add-in" description="Adds Zuri to Word, PowerPoint and Excel for this Windows user. It needs Zuri running to answer requests.">
                <Chip color={addin.installed ? 'success' : 'warning'}>{addin.installed ? 'Installed' : 'Not installed'}</Chip>
              </SettingsRow>
              {!addin.supported && (
                <SettingsRow title="Not on this computer" description="The Office add-in is available on Windows only." />
              )}
              {addin.supported && (
                <SettingsRow title="Install or remove" description="Restart Word, Excel or PowerPoint after installing.">
                  <span className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onPress={() => void installOfficeAddin()} isDisabled={addinBusy || addin.installed}>Install</Button>
                    <Button size="sm" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeOfficeAddin()} isDisabled={addinBusy || !addin.installed}>Remove</Button>
                  </span>
                </SettingsRow>
              )}
            </SettingsCard>
          )}

          {status === 'ready' && section === 'advanced' && (
            <>
              <p className="zuri-settings-block-help">Act mode can only open apps and sites listed here. Empty lists block everything.</p>
              <SettingsCard>
                <SettingsRow title="Allow an app or site" description="Added to whichever list you pick.">
                  <form onSubmit={addAllowed} className="zuri-settings-inline-form">
                    <SelectField label="Type" hideLabel compact value={allowKind} options={[{ value: 'apps', label: 'App' }, { value: 'urls', label: 'Site' }]} onChange={setAllowKind} className="min-w-24" />
                    <Input aria-label="App or site" value={allowValue} onChange={(event) => setAllowValue(event.target.value)} placeholder={allowKind === 'apps' ? 'notepad.exe' : 'https://example.com'} className="min-w-40 flex-1" />
                    <Button type="submit" size="sm" variant="secondary">Add</Button>
                  </form>
                </SettingsRow>
              </SettingsCard>

              <section className="zuri-settings-block">
                <h3 className="zuri-settings-block-title">Apps</h3>
                {listFor('apps').length === 0 ? <p className="zuri-settings-block-help">No apps added yet.</p> : (
                  <ul className="zuri-settings-list">
                    {listFor('apps').map((value) => (
                      <li key={value}>
                        <span className="truncate">{value}</span>
                        <Button size="xs" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeAllowed('apps', value)}>Remove</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="zuri-settings-block">
                <h3 className="zuri-settings-block-title">Sites</h3>
                {listFor('urls').length === 0 ? <p className="zuri-settings-block-help">No sites added yet.</p> : (
                  <ul className="zuri-settings-list">
                    {listFor('urls').map((value) => (
                      <li key={value}>
                        <span className="truncate">{value}</span>
                        <Button size="xs" variant="ghost" className="zuri-danger-quiet" onPress={() => void removeAllowed('urls', value)}>Remove</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
