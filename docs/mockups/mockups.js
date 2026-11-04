const root = document.documentElement;
const SCREENS = ['home', 'dashboard', 'chat', 'conversation', 'tasks', 'settings'];

// The same destinations as src/renderer-react/Sidebar.jsx, plus the proposed Dashboard at the top.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', screen: 'dashboard' },
  { key: 'chats', label: 'Chats', icon: 'message-square', screen: 'chat' },
  { key: 'agents', label: 'Agents', icon: 'bot' },
  { key: 'tasks', label: 'Tasks', icon: 'list-checks', screen: 'tasks' },
  { key: 'reminders', label: 'Reminders', icon: 'bell' },
  { key: 'automations', label: 'Automations', icon: 'clock-3' },
  { key: 'files', label: 'Files', icon: 'folder' },
  { key: 'features', label: 'Features', icon: 'layout-grid' },
  { key: 'cloud', label: 'Zuri Cloud', icon: 'cloud' },
  { key: 'settings', label: 'Settings', icon: 'settings', screen: 'settings' },
];
// On a phone the rail becomes a bottom bar of five, so the rest would not fit.
const PHONE_KEYS = ['dashboard', 'chats', 'tasks', 'files', 'settings'];
const RECENTS = ['Launch plan outline', 'Weekly report draft', 'Budget questions', 'Client proposal notes'];

// Tailwind class sets, kept here so the tabs and chips can swap between two looks.
const TAB_ON = ['bg-blue-100', 'text-blue-700', 'dark:bg-night-sel', 'dark:text-night-text'];
const TAB_OFF = ['text-mute', 'dark:text-night-muted'];
const CHOICE_ON = ['border-blue-600', 'bg-blue-100', 'text-blue-700', 'dark:border-night-accent', 'dark:bg-night-sel', 'dark:text-night-text'];
const CHOICE_OFF = ['border-line', 'bg-white', 'dark:border-night-line', 'dark:bg-night-surface'];

function buildShell(slot) {
  const current = slot.dataset.shell;
  const rail = NAV_ITEMS.map((item) => {
    const selected = item.key === current
      ? 'bg-blue-100 text-blue-700 dark:bg-night-sel dark:text-night-text'
      : 'text-white/70 hover:bg-white/10 hover:text-white';
    const visibility = PHONE_KEYS.includes(item.key) ? 'flex' : 'hidden md:flex';
    return `<button type="button" aria-label="${item.label}" title="${item.label}"${item.screen ? ` data-screen="${item.screen}"` : ''} class="${visibility} h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 ${selected} md:size-8 md:min-w-0 md:rounded-full md:p-0"><i data-lucide="${item.icon}" class="size-[18px] shrink-0"></i><span class="text-[10px] md:hidden">${item.label}</span></button>`;
  }).join('');
  const recents = RECENTS.map((title, index) => {
    const active = index === 0 && current === 'chats' ? 'bg-blue-600/30 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white';
    return `<button type="button" class="truncate rounded-full px-3 py-2 text-left text-[13px] ${active}">${title}</button>`;
  }).join('');

  slot.insertAdjacentHTML('afterbegin', `
    <nav aria-label="Destinations" class="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-white/15 bg-navy pb-[env(safe-area-inset-bottom)] dark:bg-night-rail md:static md:h-auto md:w-12 md:shrink-0 md:flex-col md:justify-start md:gap-1.5 md:border-r md:border-t-0 md:py-3 md:pb-3">${rail}</nav>
    <aside aria-label="Conversations" class="hidden w-56 shrink-0 flex-col bg-navy text-white dark:bg-night-rail md:flex lg:w-60">
      <div class="flex items-center justify-between px-4 pb-2 pt-3.5">
        <button type="button" class="inline-flex items-center gap-1 font-display text-base font-semibold">Zuri<i data-lucide="chevron-down" class="size-3.5"></i></button>
        <div class="flex gap-0.5">
          <button type="button" aria-label="Search conversations" class="grid size-[30px] place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white"><i data-lucide="search" class="size-4"></i></button>
          <button type="button" aria-label="Switch theme" data-theme-toggle class="grid size-[30px] place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white"><i data-lucide="moon" class="size-4"></i></button>
        </div>
      </div>
      <button type="button" data-screen="chat" class="mx-2.5 inline-flex min-h-9 items-center justify-start gap-2 rounded-full bg-blue-600 px-4 font-display text-[13px] font-semibold text-white hover:bg-blue-700 dark:bg-night-accent dark:text-night-bg dark:hover:bg-[#c6ceff]"><i data-lucide="pencil" class="size-[18px]"></i>New chat</button>
      <div class="flex items-center justify-between px-4 pb-1.5 pt-4 text-white/70"><p class="text-xs font-medium uppercase tracking-wider">Recents</p><i data-lucide="history" class="size-4"></i></div>
      <div class="flex flex-1 flex-col gap-1 overflow-y-auto px-2.5">${recents}</div>
    </aside>`);
}

document.querySelectorAll('[data-shell]').forEach(buildShell);

const panels = [...document.querySelectorAll('[data-screen-panel]')];

function showScreen(screen) {
  const target = SCREENS.includes(screen) ? screen : 'home';
  panels.forEach((panel) => {
    const on = panel.dataset.screenPanel === target;
    // App screens lay the rail, panel and main out in a row; the home page is a normal block.
    panel.classList.toggle('hidden', !on);
    panel.classList.toggle(panel.dataset.shell ? 'flex' : 'block', on);
  });
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const on = tab.dataset.screen === target;
    TAB_ON.forEach((name) => tab.classList.toggle(name, on));
    TAB_OFF.forEach((name) => tab.classList.toggle(name, !on));
  });
  window.scrollTo(0, 0);
  history.replaceState(null, '', `#${target}`);
}

// One delegated listener covers the buttons the shell builder added as well.
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-screen]');
  if (!link) return;
  event.preventDefault();
  showScreen(link.dataset.screen);
});

function paintThemeButtons() {
  const dark = root.classList.contains('dark');
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" class="size-4"></i>`;
  });
  window.lucide?.createIcons();
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-theme-toggle]')) return;
  root.classList.toggle('dark');
  paintThemeButtons();
});

document.querySelectorAll('[data-composer]').forEach((form) => form.addEventListener('submit', (event) => {
  event.preventDefault();
  const note = form.parentElement.querySelector('[data-note]');
  if (note) note.textContent = 'Zuri is ready for that. This is a mockup, so nothing was sent.';
}));

// The jump arrow shows only while the reader is scrolled away from the newest message.
const thread = document.querySelector('[data-thread]');
const jump = document.querySelector('[data-jump]');
function paintJump() {
  const away = thread.scrollHeight - thread.scrollTop - thread.clientHeight > 80;
  jump.classList.toggle('hidden', !away);
}
if (thread && jump) {
  thread.addEventListener('scroll', paintJump);
  jump.addEventListener('click', () => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }));
  new ResizeObserver(paintJump).observe(thread);
}

document.querySelectorAll('[data-toggle]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const on = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', String(on));
    CHOICE_ON.forEach((name) => chip.classList.toggle(name, on));
    ['border-line', 'text-mute', 'dark:border-night-line', 'dark:text-night-muted'].forEach((name) => chip.classList.toggle(name, !on));
  });
});

document.querySelector('[data-add-task]')?.addEventListener('click', () => {
  const list = document.querySelector('[data-task-list]');
  if (!list) return;
  list.insertAdjacentHTML('afterbegin', '<li class="flex min-h-12 items-center justify-between gap-3 rounded-[14px] border border-line px-3.5 py-1.5 hover:border-blue-600 dark:border-night-line dark:hover:border-night-accent"><label class="flex min-h-11 flex-1 cursor-pointer items-center gap-3 md:min-h-9"><input type="checkbox" class="size-5 shrink-0 rounded-md border-line accent-blue-600"><span><b class="block font-display text-[13px] font-semibold">New task</b><small class="text-xs text-mute dark:text-night-muted">Just now</small></span></label><span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-mute dark:bg-night-bg dark:text-night-muted">New</span></li>');
});

const choices = [...document.querySelectorAll('[data-choice]')];
choices.forEach((choice) => {
  choice.addEventListener('click', () => {
    choices.forEach((item) => {
      const on = item === choice;
      CHOICE_ON.forEach((name) => item.classList.toggle(name, on));
      CHOICE_OFF.forEach((name) => item.classList.toggle(name, !on));
    });
  });
});

document.querySelector('[data-settings-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  event.currentTarget.querySelector('[data-form-note]').textContent = 'Saved. Your settings are up to date.';
});

showScreen(window.location.hash.slice(1));
paintThemeButtons();
// replaceState in showScreen does not fire this, so it only reacts to typed or pasted addresses.
window.addEventListener('hashchange', () => showScreen(window.location.hash.slice(1)));
