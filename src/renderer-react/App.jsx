import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import ChatPanel from './ChatPanel.jsx';
import AgentsView from './AgentsView.jsx';
import AutomationsView from './AutomationsView.jsx';
import FilesView from './FilesView.jsx';
import SettingsView from './SettingsView.jsx';
import TasksView from './TasksView.jsx';
import RemindersView from './RemindersView.jsx';
// The shell and every destination are now served by the React renderer.
export default function App() {
  const [route, setRoute] = useState('chats');

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <Sidebar current={route} onNavigate={setRoute} />
      {route === 'chats' && <ChatPanel />}
      {route === 'agents' && <AgentsView />}
      {route === 'automations' && <AutomationsView />}
      {route === 'files' && <FilesView />}
      {route === 'settings' && <SettingsView />}
      {route === 'tasks' && <TasksView />}
      {route === 'reminders' && <RemindersView />}
    </div>
  );
}
