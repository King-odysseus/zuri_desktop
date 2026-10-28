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
import FeaturesView from './FeaturesView.jsx';
import SignUpView from './SignUpView.jsx';
import CloudView from './CloudView.jsx';
import SignInView from './SignInView.jsx';
import NewProjectView from './NewProjectView.jsx';
// The shell and every destination are now served by the React renderer.
export default function App() {
  const isOverlay = new URLSearchParams(window.location.search).has('overlay');
  const [route, setRoute] = useState('chats');
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  // The chat window toggles the sidebar from its own floating control, so the
  // state lives here rather than inside Sidebar where the chat view could not
  // reach it without opening the rail first.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Sign-in has to be decided before the shell paints: a returning user must not see
  // the chat view flash before the session is checked, and a signed-out one should not
  // see it at all. The quick-ask window never signs in, so it starts ready.
  const [startup, setStartup] = useState(isOverlay ? 'ready' : 'pending');
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (isOverlay) return undefined;
    let active = true;
    // Two reads answer what the shell asks before it paints: the saved theme, and
    // whether a Zuri session exists. Only "sign in required" shows the sign-in
    // screen; a network failure lets a signed-in person into their saved chats.
    const loadSettings = async () => {
      const [result, account] = await Promise.all([
        window.zuri?.settings?.get?.(),
        window.zuri?.cloud?.account?.(),
      ]);
      if (!active) return;
      const savedTheme = result?.ok && result.data?.theme === 'light' ? 'light' : result?.ok ? 'dark' : null;
      if (savedTheme) {
        document.documentElement.dataset.theme = savedTheme;
        setTheme(savedTheme);
      }
      // Anything but a loaded account asks for sign-in; being offline is the one
      // failure that is not a missing session, so a signed-in person still gets in.
      setNeedsSignIn(account?.ok !== true && account?.error?.code !== 'CLOUD_UNAVAILABLE');
      setStartup('ready');
    };
    void loadSettings();
    // Signing out anywhere in the app (the account page, Settings) returns to the
    // sign-in screen instead of leaving a signed-out shell on screen.
    const onSignedOut = () => setNeedsSignIn(true);
    window.addEventListener('zuri:signed-out', onSignedOut);
    return () => {
      active = false;
      window.removeEventListener('zuri:signed-out', onSignedOut);
    };
  }, [isOverlay]);

  // Ctrl+K (Cmd+K on a Mac) starts a new chat from anywhere in the shell. Only the
  // state setters run, so one listener for the life of the window is enough.
  useEffect(() => {
    if (isOverlay) return undefined;
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setRoute('chats');
      setActiveThreadId('');
      setChatSessionKey((key) => key + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOverlay]);

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

  function finishSignIn(saved) {
    // The card already painted its choice; store it in state so the shell and the
    // title bar agree with what the person picked. The painted value is the answer
    // when main echoes nothing back, so an empty reply cannot flip the window.
    const chosen =
      saved?.theme === 'light' || saved?.theme === 'dark'
        ? saved.theme
        : document.documentElement.dataset.theme === 'dark'
          ? 'dark'
          : 'light';
    document.documentElement.dataset.theme = chosen;
    setTheme(chosen);
    setNeedsSignIn(false);
  }

  if (isOverlay) {
    return (
      <div className="zuri-overlay-root">
        <ChatPanel compact onChatUpdated={refreshChats} />
      </div>
    );
  }

  // The page behind the sign-in check: no sidebar, no chat, nothing that would
  // read as a loaded app to someone who may be asked to sign in.
  if (startup === 'pending') {
    return <div className="flex h-dvh w-full bg-background text-foreground" />;
  }

  if (needsSignIn) {
    return <SignInView onDone={finishSignIn} />;
  }

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <Sidebar current={route} onNavigate={setRoute} onNewChat={startNewChat} onSelectThread={openThread} activeThreadId={activeThreadId} refreshKey={chatRefreshKey} theme={theme} onToggleTheme={toggleTheme} collapsed={sidebarCollapsed} onToggleCollapsed={setSidebarCollapsed} />
      {route === 'chats' && <ChatPanel key={chatSessionKey} initialThreadId={activeThreadId} onChatUpdated={refreshChats} onNavigate={setRoute} onNewChat={startNewChat} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((value) => !value)} openingKind={chatSessionKey % 2 === 0 ? 'greeting' : 'question'} />}
      {route === 'new-project' && <NewProjectView onCreated={() => { refreshChats(); setRoute('chats'); }} />}
      {route === 'agents' && <AgentsView />}
      {route === 'automations' && <AutomationsView />}
      {route === 'files' && <FilesView />}
      {route === 'settings' && <SettingsView />}
      {route === 'tasks' && <TasksView />}
      {route === 'reminders' && <RemindersView />}
      {route === 'search' && <SearchView onSelectThread={openThread} />}
      {route === 'features' && <FeaturesView onNavigate={setRoute} />}
      {route === 'cloud' && <CloudView onNavigate={setRoute} />}
      {route === 'signup' && <SignUpView onNavigate={setRoute} />}
      {route === 'history' && <HistoryView onSelectThread={openThread} />}
    </div>
  );
}
