import { useEffect, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import ChatPanel from './ChatPanel.jsx';
import AgentsView from './AgentsView.jsx';
import AutomationsView from './AutomationsView.jsx';
import FilesView from './FilesView.jsx';
import SettingsView from './SettingsView.jsx';
import TasksView from './TasksView.jsx';
import RemindersView from './RemindersView.jsx';
import SearchView from './SearchView.jsx';
// The shell and every destination are now served by the React renderer.
export default function App() {
  const [route, setRoute] = useState('chats');
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    let active = true;
    const loadTheme = async () => {
      const result = await window.zuri?.settings?.get?.();
      const savedTheme = result?.ok && result.data?.theme === 'light' ? 'light' : result?.ok ? 'dark' : null;
      if (!active || !savedTheme) return;
      document.documentElement.dataset.theme = savedTheme;
      setTheme(savedTheme);
    };
    void loadTheme();
    return () => { active = false; };
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    void window.zuri?.settings?.save?.({ theme: next });
  }

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <Sidebar current={route} onNavigate={setRoute} theme={theme} onToggleTheme={toggleTheme} />
      {route === 'chats' && <ChatPanel />}
      {route === 'agents' && <AgentsView />}
      {route === 'automations' && <AutomationsView />}
      {route === 'files' && <FilesView />}
      {route === 'settings' && <SettingsView />}
      {route === 'tasks' && <TasksView />}
      {route === 'reminders' && <RemindersView />}
      {route === 'search' && <SearchView />}
    </div>
  );
}
