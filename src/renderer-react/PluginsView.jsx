import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox } from './ui.jsx';
import { GridIcon, LockIcon, SkillsIcon } from './Icons.jsx';

const PREVIEW_TOOLS = [
  { name: 'createTask', label: 'Add a task', description: 'Put a to-do on the Tasks page.' },
  { name: 'createReminder', label: 'Set a reminder', description: 'Notify you at a time you choose.' },
  { name: 'webSearch', label: 'Search the web', description: 'Find current information online.' },
  { name: 'readFile', label: 'Read files', description: 'Read text and Office documents in your workspace.' },
  { name: 'createDocument', label: 'Create documents', description: 'Build Word, Excel or PowerPoint files.' },
  { name: 'summarizeDocument', label: 'Summarise documents', description: 'Turn a long document into a useful summary.' },
  { name: 'writeFile', label: 'Save files', description: 'Save text or Markdown in your workspace.' },
  { name: 'editDocument', label: 'Edit documents', description: 'Create an edited copy of an Office file.' },
  { name: 'openUrl', label: 'Open links', description: 'Open an allowed link in your browser.' },
  { name: 'openApp', label: 'Start apps', description: 'Start an app on your allow-list.' },
  { name: 'createAutomation', label: 'Create automations', description: 'Schedule Zuri to do work later.' },
  { name: 'createMemory', label: 'Remember facts', description: 'Save a preference across signed-in chats.' },
];

function safeTools(value) {
  return Array.isArray(value) && value.length > 0 ? value.filter((tool) => typeof tool?.name === 'string') : PREVIEW_TOOLS;
}

export default function PluginsView({ onNavigate = () => {} }) {
  const settingsApi = typeof window !== 'undefined' ? window.zuri?.settings : undefined;
  const toolsApi = typeof window !== 'undefined' ? window.zuri?.tools : undefined;
  const skillsApi = typeof window !== 'undefined' ? window.zuri?.skills : undefined;
  const [tools, setTools] = useState(PREVIEW_TOOLS);
  const [skills, setSkills] = useState([]);
  const [disabledTools, setDisabledTools] = useState([]);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  async function load() {
    if (typeof settingsApi?.get !== 'function') {
      setStatus('ready');
      return;
    }
    const [settings, listedTools, listedSkills] = await Promise.all([
      settingsApi.get(),
      toolsApi?.list?.(),
      skillsApi?.list?.(),
    ]);
    if (!settings?.ok) {
      setStatus('error');
      setMessage(settings?.error?.message ?? 'Plugins could not be read.');
      return;
    }
    setDisabledTools(Array.isArray(settings.data?.disabledTools) ? settings.data.disabledTools : []);
    if (listedTools?.ok) setTools(safeTools(listedTools.data));
    if (listedSkills?.ok && Array.isArray(listedSkills.data)) setSkills(listedSkills.data);
    setStatus('ready');
  }

  useEffect(() => { void load(); }, []);

  async function toggleTool(name, enabled) {
    const next = enabled ? disabledTools.filter((entry) => entry !== name) : [...new Set([...disabledTools, name])];
    setDisabledTools(next);
    const result = await settingsApi?.save?.({ disabledTools: next });
    if (!result?.ok) {
      setMessage(result?.error?.message ?? 'That tool could not be changed.');
      await load();
    } else {
      setMessage('Plugin settings saved.');
    }
  }

  const enabledTools = useMemo(() => tools.filter((tool) => !disabledTools.includes(tool.name)).length, [tools, disabledTools]);

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <header>
            <div className="flex items-start gap-3">
              <GridIcon size={24} className="mt-1 text-accent" />
              <div>
                <h1>Plugins</h1>
                <p className="mt-2">Choose which built-in tools and skills Zuri may use. Turning one off removes it from future chats; it does not delete anything.</p>
              </div>
            </div>
          </header>

          {status === 'loading' && <p className="text-sm text-muted">Reading plugins...</p>}
          {status === 'error' && <p role="alert" className="zuri-notice is-danger">{message}</p>}
          {message !== '' && status === 'ready' && <p role="status" className="zuri-notice">{message}</p>}

          <section className="zuri-plugin-section" aria-labelledby="built-in-tools-heading">
            <div className="flex items-start justify-between gap-4 px-4 pt-4">
              <div>
                <h2 id="built-in-tools-heading">Built-in tools</h2>
                <p className="mt-1 text-sm text-muted">These run through Zuri's existing approval rules. {enabledTools} of {tools.length} are on.</p>
              </div>
              <LockIcon size={18} className="shrink-0 text-muted" aria-label="Runs inside Zuri" />
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {tools.map((tool) => {
                const enabled = !disabledTools.includes(tool.name);
                return (
                  <li key={tool.name} className="flex min-h-16 items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium">{tool.label || tool.name}</h3>
                      <p className="mt-1 text-sm text-muted">{tool.description || 'A Zuri tool.'}</p>
                    </div>
                    <Checkbox isSelected={enabled} onChange={(checked) => void toggleTool(tool.name, checked)} className="min-h-11" aria-label={`${enabled ? 'Turn off' : 'Turn on'} ${tool.label || tool.name}`}>
                      {enabled ? 'On' : 'Off'}
                    </Checkbox>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="zuri-plugin-section" aria-labelledby="skills-heading">
            <div className="flex items-start gap-3 px-4 pt-4">
              <SkillsIcon size={20} className="mt-0.5 text-accent" />
              <div>
                <h2 id="skills-heading">Skills</h2>
                <p className="mt-1 text-sm text-muted">Skills are shareable instructions. Edit and switch them on from the Skills page.</p>
              </div>
            </div>
            <div className="px-4 pb-4 pt-3 text-sm text-muted">
              {skills.length === 0 ? 'No skills yet.' : `${skills.filter((skill) => skill.enabled === true).length} of ${skills.length} skills are on.`}
              <Button variant="ghost" className="ml-2 min-h-11" onPress={() => onNavigate('skills')}>Open Skills</Button>
            </div>
          </section>

          <section className="zuri-plugin-section" aria-labelledby="connectors-heading">
            <div className="flex items-start gap-3 px-4 py-4">
              <LockIcon size={20} className="mt-0.5 text-accent" />
              <div>
                <h2 id="connectors-heading">Connectors</h2>
                <p className="mt-1 text-sm text-muted">MCP connectors are planned next. They will add outside services such as Drive or GitHub without letting Zuri run unknown code inside your computer.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
