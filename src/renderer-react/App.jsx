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
import HistoryView from './HistoryView.jsx';
// The shell and every destination are now served by the React renderer.
export default function App() {
  const [route, setRoute] = useState('chats');
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

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

  function startNewChat() {
    setRoute('chats');
    setActiveThreadId('');
    setChatSessionKey((key) => key + 1);
  }

  function openThread(threadId) {
    setRoute('chats');
    setActiveThreadId(threadId);
    setChatSessionKey((key) => key + 1);
  }

  function refreshChats() {
    setChatRefreshKey((key) => key + 1);
  }

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <Sidebar current={route} onNavigate={setRoute} onNewChat={startNewChat} onSelectThread={openThread} activeThreadId={activeThreadId} refreshKey={chatRefreshKey} theme={theme} onToggleTheme={toggleTheme} />
      {route === 'chats' && <ChatPanel key={chatSessionKey} initialThreadId={activeThreadId} onChatUpdated={refreshChats} onNavigate={setRoute} />}
      {route === 'agents' && <AgentsView />}
      {route === 'automations' && <AutomationsView />}
      {route === 'files' && <FilesView />}
      {route === 'settings' && <SettingsView />}
      {route === 'tasks' && <TasksView />}
      {route === 'reminders' && <RemindersView />}
      {route === 'search' && <SearchView />}
      {route === 'history' && <HistoryView onSelectThread={openThread} />}
    </div>
  );
}
