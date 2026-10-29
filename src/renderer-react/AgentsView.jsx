import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Input, Textarea } from './ui.jsx';
import SelectField from './SelectField.jsx';

const PREVIEW_TOOLS = [
  { name: 'webSearch', label: 'Search the web' },
  { name: 'webFetch', label: 'Fetch a web page' },
  { name: 'readFile', label: 'Read a file or Office document' },
  { name: 'writeFile', label: 'Save a file in the workspace' },
  { name: 'summarizeDocument', label: 'Summarise a document' },
  { name: 'openUrl', label: 'Open a link in the browser' },
  { name: 'openApp', label: 'Start an allowed app' },
];

const PREVIEW_AGENTS = [
  {
    id: 'preview-meeting-brief',
    name: 'Meeting brief',
    systemPrompt: 'Write short meeting briefs with the key decisions and three next questions.',
    allowedTools: ['webSearch', 'webFetch', 'readFile', 'summarizeDocument'],
  },
  {
    id: 'preview-spreadsheet',
    name: 'Spreadsheet numbers',
    systemPrompt: 'Read spreadsheets and answer with one number and one sentence explaining it.',
    allowedTools: ['readFile', 'summarizeDocument'],
  },
];

// Ids match PROVIDERS in secrets.js; the empty value follows the provider chosen in Settings.
const PROVIDER_OPTIONS = [
  { value: '', label: 'Zuri default (from Settings)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'moonshot', label: 'Kimi (Moonshot)' },
  { value: 'zai', label: 'Z.ai (GLM)' },
];

function providerLabel(value) {
  return PROVIDER_OPTIONS.find((option) => option.value === value)?.label ?? PROVIDER_OPTIONS[0].label;
}

function cloneAgents(agents) {
  return Array.isArray(agents)
    ? agents.map((agent) => ({
        id: String(agent?.id ?? ''),
        name: String(agent?.name ?? ''),
        systemPrompt: String(agent?.systemPrompt ?? ''),
        allowedTools: Array.isArray(agent?.allowedTools)
          ? agent.allowedTools.filter((tool) => typeof tool === 'string')
          : [],
        provider: PROVIDER_OPTIONS.some((option) => option.value === agent?.provider) ? agent.provider : '',
      }))
    : [];
}

function newAgentId() {
  return globalThis.crypto?.randomUUID?.() ?? `agent-${Date.now()}`;
}

export default function AgentsView() {
  const settingsApi = typeof window !== 'undefined' ? window.zuri?.settings : undefined;
  const toolsApi = typeof window !== 'undefined' ? window.zuri?.tools : undefined;
  const [agents, setAgents] = useState([]);
  const [activeAgentId, setActiveAgentId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [tools, setTools] = useState(PREVIEW_TOOLS);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  // The form shows only while adding or editing; the page is otherwise a plain list.
  const [editorOpen, setEditorOpen] = useState(false);

  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  async function load() {
    if (typeof settingsApi?.get !== 'function') {
      const preview = cloneAgents(PREVIEW_AGENTS);
      setAgents(preview);
      setActiveAgentId(preview[0]?.id ?? '');
      setSelectedId(preview[0]?.id ?? '');
      setStatus('ready');
      return;
    }
    try {
      const result = await settingsApi.get();
      if (!result?.ok) {
        setStatus('error');
        setMessage(result?.error?.message ?? 'Settings could not be read.');
        return;
      }
      const loaded = cloneAgents(result.data?.agents);
      setAgents(loaded);
      const active = typeof result.data?.activeAgentId === 'string' ? result.data.activeAgentId : '';
      setActiveAgentId(active);
      setSelectedId((current) => (loaded.some((agent) => agent.id === current) ? current : loaded[0]?.id ?? ''));
      if (typeof toolsApi?.list === 'function') {
        const listed = await toolsApi.list();
        if (listed?.ok && Array.isArray(listed.data) && listed.data.length > 0) {
          setTools(
            listed.data.map((tool) => ({
              name: String(tool?.name ?? ''),
              label: String(tool?.label ?? tool?.name ?? ''),
            })),
          );
        }
      }
      setStatus('ready');
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

  function updateSelected(patch) {
    setAgents((current) => current.map((agent) => (agent.id === selectedId ? { ...agent, ...patch } : agent)));
    setMessage('Unsaved changes');
  }

  function addAgent() {
    const agent = { id: newAgentId(), name: 'New agent', systemPrompt: '', allowedTools: [], provider: '' };
    setAgents((current) => [...current, agent]);
    setSelectedId(agent.id);
    setEditorOpen(true);
    setMessage('Unsaved changes');
  }

  function removeSelected() {
    if (!selected) return;
    const remaining = agents.filter((agent) => agent.id !== selected.id);
    setAgents(remaining);
    setSelectedId(remaining[0]?.id ?? '');
    setEditorOpen(false);
    if (activeAgentId === selected.id) setActiveAgentId('');
    setMessage('Unsaved changes');
  }

  async function save() {
    if (!selected && agents.length > 0) return;
    const nameless = agents.find((agent) => agent.name.trim() === '');
    if (nameless) {
      setSelectedId(nameless.id);
      setMessage('Every agent needs a name before it can be saved.');
      return;
    }
    if (typeof settingsApi?.save !== 'function') {
      setMessage('Preview mode: settings.json is not reachable.');
      return;
    }
    const result = await settingsApi.save({ agents, activeAgentId });
    setMessage(result?.ok ? 'Saved to settings.json.' : result?.error?.message ?? 'That save failed.');
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-background text-foreground">
      <div className="zuri-page-content zuri-scrollbar-hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1>AI agents</h1>
              <p>Give a chat a name, a way of writing, and the tools it may use.</p>
            </div>
            <Button variant="primary" className="shrink-0" onPress={addAgent}>New agent</Button>
          </header>

          {status === 'loading' && <p className="text-sm text-muted">Reading settings...</p>}
          {status === 'error' && <p role="alert" className="zuri-notice is-danger text-sm text-danger">{message}</p>}
          {status === 'ready' && (
            <>
              <section aria-label="Agents">
                {agents.length === 0 ? (
                  <div className="zuri-empty-state">
                    <strong>No agents yet</strong>
                    <p>Create an agent to give a chat a name and a set of tools.</p>
                  </div>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {agents.map((agent) => {
                      const isSelected = editorOpen && agent.id === selectedId;
                      return (
                        <li key={agent.id}>
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            className="flex min-h-11 w-full items-center gap-3 py-3 text-left hover:bg-surface-secondary/60"
                            onClick={() => { setSelectedId(agent.id); setEditorOpen(true); }}
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className={`truncate text-sm ${isSelected ? 'font-semibold' : 'font-medium'}`}>{agent.name || 'Untitled agent'}</span>
                              <span className="text-xs text-muted">
                                {providerLabel(agent.provider)} - {agent.allowedTools.length} {agent.allowedTools.length === 1 ? 'tool' : 'tools'}
                              </span>
                            </span>
                            {agent.id === activeAgentId && <Chip size="sm" color="primary">Active for chat</Chip>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {editorOpen && selected && (
                <section className="zuri-agents-editor flex flex-col gap-5 border-t border-border pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-medium">{selected.name || 'Untitled agent'}</h2>
                    <Button variant="ghost" onPress={() => setEditorOpen(false)}>Close</Button>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <Input label="Name" value={selected.name} maxLength={60} onChange={(event) => updateSelected({ name: event.target.value })} />
                    <Checkbox className="lg:mb-3" isSelected={selected.id === activeAgentId} onChange={(checked) => setActiveAgentId(checked ? selected.id : '')}>
                      Use this agent in chat
                    </Checkbox>
                  </div>

                  <SelectField
                    label="Provider"
                    value={selected.provider}
                    options={PROVIDER_OPTIONS}
                    onChange={(value) => updateSelected({ provider: value })}
                  />

                  <Textarea
                    label="System prompt"
                    value={selected.systemPrompt}
                    onChange={(event) => updateSelected({ systemPrompt: event.target.value })}
                    placeholder="You write short meeting briefs..."
                    rows={5}
                  />

                  <div>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">Allowed tools</p>
                      <span className="text-xs text-muted">{selected.allowedTools.length} of {tools.length} tools allowed</span>
                    </div>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {tools.map((tool) => (
                        <Checkbox
                          key={tool.name}
                          isSelected={selected.allowedTools.includes(tool.name)}
                          onChange={(checked) => updateSelected({ allowedTools: checked ? [...selected.allowedTools, tool.name] : selected.allowedTools.filter((name) => name !== tool.name) })}
                        >
                          {tool.label}
                        </Checkbox>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button variant="ghost" className="zuri-danger-quiet" onPress={removeSelected}>Delete agent</Button>
                    <div className="ml-auto flex items-center gap-2">
                      <Button variant="ghost" onPress={() => void load()}>Revert</Button>
                      <Button variant="primary" onPress={() => void save()}>Save agent</Button>
                    </div>
                  </div>
                </section>
              )}
              {message !== '' && <p role="status" className="text-xs text-muted">{message}</p>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
