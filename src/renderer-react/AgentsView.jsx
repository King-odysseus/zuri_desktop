import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Input, Textarea } from './ui.jsx';

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

function cloneAgents(agents) {
  return Array.isArray(agents)
    ? agents.map((agent) => ({
        id: String(agent?.id ?? ''),
        name: String(agent?.name ?? ''),
        systemPrompt: String(agent?.systemPrompt ?? ''),
        allowedTools: Array.isArray(agent?.allowedTools)
          ? agent.allowedTools.filter((tool) => typeof tool === 'string')
          : [],
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
    const agent = { id: newAgentId(), name: 'New agent', systemPrompt: '', allowedTools: [] };
    setAgents((current) => [...current, agent]);
    setSelectedId(agent.id);
    setMessage('Unsaved changes');
  }

  function removeSelected() {
    if (!selected) return;
    const remaining = agents.filter((agent) => agent.id !== selected.id);
    setAgents(remaining);
    setSelectedId(remaining[0]?.id ?? '');
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
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>AI agents</h1>
            <p>Give a chat a name, a way of writing, and the tools it may use.</p>
          </div>
          <Button variant="primary" className="ml-auto" onPress={addAgent}>New agent</Button>
        </header>

        {status === 'loading' && <p className="text-sm text-muted">Reading settings...</p>}
        {status === 'error' && <p role="alert" className="text-sm text-danger">{message}</p>}
        {status === 'ready' && (
          <div className="zuri-agents-layout grid min-h-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <section className="rounded-xl border border-border bg-surface-secondary p-3" aria-label="Agents">
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="text-sm font-medium">Agents</span>
                <Chip size="sm">{agents.length}</Chip>
              </div>
              <div className="flex flex-col gap-1">
                {agents.map((agent) => {
                  const isSelected = agent.id === selectedId;
                  return (
                    <Button
                      key={agent.id}
                      variant={isSelected ? 'secondary' : 'ghost'}
                      aria-pressed={isSelected}
                      className={`relative h-auto w-full justify-start rounded-lg px-3 py-2 text-left ${isSelected ? 'font-semibold' : ''}`}
                      onPress={() => setSelectedId(agent.id)}
                    >
                      {isSelected && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
                      <span className="flex min-w-0 flex-1 flex-col items-start">
                        <span className="w-full truncate text-sm">{agent.name || 'Untitled agent'}</span>
                        <span className="text-xs text-muted">
                          {agent.allowedTools.length} {agent.allowedTools.length === 1 ? 'tool' : 'tools'}
                        </span>
                      </span>
                    </Button>
                  );
                })}
                {agents.length === 0 && <p className="px-2 py-4 text-xs text-muted">No agents yet.</p>}
              </div>
            </section>

            <section className="zuri-agents-editor rounded-xl border border-border bg-surface p-5">
              {!selected ? (
                <div className="zuri-empty-state">
                  <strong>No agent selected</strong>
                  <p>Create an agent to give a chat a name and a set of tools.</p>
                  <Button variant="secondary" onPress={addAgent}>New agent</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-medium">{selected.name || 'Untitled agent'}</h2>
                    {selected.id === activeAgentId && <Chip color="primary">Active for chat</Chip>}
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <Input label="Name" value={selected.name} maxLength={60} onChange={(event) => updateSelected({ name: event.target.value })} />
                    <Checkbox className="lg:mb-3" isSelected={selected.id === activeAgentId} onChange={(checked) => setActiveAgentId(checked ? selected.id : '')}>
                      Use this agent in chat
                    </Checkbox>
                  </div>

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
                    <div className="grid gap-2 rounded-xl border border-border bg-surface-secondary p-4 lg:grid-cols-2">
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

                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                    <Button variant="ghost" className="zuri-danger-quiet" onPress={removeSelected}>Delete agent</Button>
                    {message !== '' && <span role="status" className="min-w-0 flex-1 text-sm text-muted">{message}</span>}
                    <div className="ml-auto flex items-center gap-2">
                      <Button variant="ghost" onPress={() => void load()}>Revert</Button>
                      <Button variant="primary" onPress={() => void save()}>Save agent</Button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
