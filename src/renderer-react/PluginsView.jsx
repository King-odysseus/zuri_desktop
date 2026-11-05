import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Switch, Textarea } from './ui.jsx';
import { GridIcon, LockIcon, SkillsIcon } from './Icons.jsx';

const PREVIEW_TOOLS = [
  { name: 'createTask', label: 'Add a task', description: 'Put a to-do on the Tasks page.' },
  { name: 'createReminder', label: 'Set a reminder', description: 'Notify you at a time you choose.' },
  { name: 'webSearch', label: 'Search the web', description: 'Find current information online.' },
  { name: 'readFile', label: 'Read files', description: 'Read text and Office documents in your workspace.' },
  { name: 'createDocument', label: 'Create documents', description: 'Build Word, Excel, PowerPoint or PDF files.' },
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
  const mcpApi = typeof window !== 'undefined' ? window.zuri?.mcp : undefined;
  const [tools, setTools] = useState(PREVIEW_TOOLS);
  const [skills, setSkills] = useState([]);
  const [disabledTools, setDisabledTools] = useState([]);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [servers, setServers] = useState([]);
  const [serverForm, setServerForm] = useState({ id: '', name: '', command: '', args: '', cwd: '', env: '', enabled: false });
  const [serverBusy, setServerBusy] = useState(false);

  async function load() {
    if (typeof settingsApi?.get !== 'function') {
      setStatus('ready');
      return;
    }
    const [settings, listedTools, listedSkills, listedServers] = await Promise.all([
      settingsApi.get(),
      toolsApi?.list?.(),
      skillsApi?.list?.(),
      mcpApi?.list?.(),
    ]);
    if (!settings?.ok) {
      setStatus('error');
      setMessage(settings?.error?.message ?? 'Plugins could not be read.');
      return;
    }
    setDisabledTools(Array.isArray(settings.data?.disabledTools) ? settings.data.disabledTools : []);
    if (listedTools?.ok) setTools(safeTools(listedTools.data));
    if (listedSkills?.ok && Array.isArray(listedSkills.data)) setSkills(listedSkills.data);
    if (listedServers?.ok && Array.isArray(listedServers.data)) setServers(listedServers.data);
    setStatus('ready');
  }

  function clearServerForm() {
    setServerForm({ id: '', name: '', command: '', args: '', cwd: '', env: '', enabled: false });
  }

  async function saveServer(event) {
    event.preventDefault();
    setServerBusy(true);
    try {
      let env = {};
      if (serverForm.env.trim() !== '') {
        env = JSON.parse(serverForm.env);
        if (env === null || typeof env !== 'object' || Array.isArray(env)) throw new Error('Environment must be a JSON object.');
      }
      const result = await mcpApi?.save?.({ server: {
        id: serverForm.id.trim() || `server-${Date.now().toString(36)}`,
        name: serverForm.name,
        command: serverForm.command,
        args: serverForm.args.split(/\s+/).filter(Boolean),
        cwd: serverForm.cwd,
        env,
        enabled: serverForm.enabled,
      } });
      if (!result?.ok) throw new Error(result?.error?.message ?? 'The connector could not be saved.');
      setMessage('MCP connector saved.');
      clearServerForm();
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setServerBusy(false);
    }
  }

  async function testServer(server) {
    setServerBusy(true);
    const result = await mcpApi?.test?.({ server });
    setMessage(result?.ok ? `${server.name} found ${result.data.tools.length} tool${result.data.tools.length === 1 ? '' : 's'}.` : (result?.error?.message ?? 'The connector test failed.'));
    setServerBusy(false);
  }

  async function toggleServer(server, enabled) {
    const result = await mcpApi?.save?.({ server: { ...server, enabled } });
    if (!result?.ok) setMessage(result?.error?.message ?? 'The connector could not be changed.');
    else await load();
  }

  async function removeServer(id) {
    if (!window.confirm('Remove this MCP connector?')) return;
    const result = await mcpApi?.remove?.({ id });
    if (!result?.ok) setMessage(result?.error?.message ?? 'The connector could not be removed.');
    else { setMessage('MCP connector removed.'); await load(); }
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
                    <Switch isSelected={enabled} onChange={(checked) => void toggleTool(tool.name, checked)} aria-label={`${enabled ? 'Turn off' : 'Turn on'} ${tool.label || tool.name}`} />
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
            <div className="flex items-start gap-3 px-4 pt-4">
              <LockIcon size={20} className="mt-0.5 text-accent" />
              <div>
                <h2 id="connectors-heading">Connectors</h2>
                <p className="mt-1 text-sm text-muted">Connect local MCP servers such as Drive or GitHub. Every discovered tool asks for approval before it runs.</p>
              </div>
            </div>
            <div className="px-4 pb-4 pt-3">
              {servers.length > 0 && <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {servers.map((server) => <li key={server.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1"><h3 className="font-medium">{server.name}</h3><p className="truncate text-xs text-muted">{server.command} {server.args?.join(' ')}</p></div>
                  <Switch isSelected={server.enabled === true} onChange={(checked) => void toggleServer(server, checked)} aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`} />
                  <Button size="sm" variant="secondary" isDisabled={serverBusy} onPress={() => void testServer(server)}>Test</Button>
                  <Button size="sm" variant="ghost" onPress={() => void removeServer(server.id)}>Remove</Button>
                </li>)}
              </ul>}
              <form className="mt-4 grid gap-3" onSubmit={saveServer}>
                <div className="grid gap-3 sm:grid-cols-2"><Input label="Name" value={serverForm.name} onChange={(event) => setServerForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Local tools" /><Input label="Command" value={serverForm.command} onChange={(event) => setServerForm((current) => ({ ...current, command: event.target.value }))} required placeholder="npx" /></div>
                <Input label="Arguments, separated by spaces" value={serverForm.args} onChange={(event) => setServerForm((current) => ({ ...current, args: event.target.value }))} placeholder="-y @modelcontextprotocol/server-filesystem C:\\Work" />
                <Input label="Working folder, optional" value={serverForm.cwd} onChange={(event) => setServerForm((current) => ({ ...current, cwd: event.target.value }))} placeholder="C:\\Work" />
                <Textarea label="Environment JSON, optional" rows={2} value={serverForm.env} onChange={(event) => setServerForm((current) => ({ ...current, env: event.target.value }))} placeholder={'{"API_TOKEN":"value"}'} />
                <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox isSelected={serverForm.enabled} onChange={(checked) => setServerForm((current) => ({ ...current, enabled: checked }))}>Enable after saving</Checkbox></label>
                <div><Button type="submit" isDisabled={serverBusy || serverForm.name.trim() === '' || serverForm.command.trim() === ''}>{serverBusy ? 'Saving...' : 'Add connector'}</Button></div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
