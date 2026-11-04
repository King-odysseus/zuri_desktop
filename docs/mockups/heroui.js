// Zuri web UI mockups, HeroUI component style. Mockup only: nothing here is imported by the app.
// Rules this file follows:
//  - Pure white page. The only colours are blue, navy and bronze (plus pale tints of them). No green, red, violet or coral.
//  - The user view is a ChatGPT-style chat: history sidebar, centred thread, one message box. It has no dashboard.
//  - The dashboard, user list and plans live in an Admin area that only admins can open, with a switch to the user view.
//  - Cards and buttons are flat: separated by fill colour, with no border and no shadow. Only floating menus cast a shadow.

const PALETTE = {
  canvas: '#ffffff', c1: '#ffffff', c2: '#f3f6fc', c3: '#e6edfa', c4: '#d3def5', line: '#e6edfa',
  ink: '#0d1b3a', navy: '#0d1b3a', muted: '#55627f', faint: '#7f8aa3',
  pri: '#2f6fed', 'pri-soft': '#e8effc', 'pri-ink': '#1b47b8',
  bronze: '#9a6830', 'bronze-soft': '#f6ede2', 'bronze-ink': '#7a4f1f',
};
Object.entries(PALETTE).forEach(([name, value]) => document.documentElement.style.setProperty(`--${name}`, value));

// Inside the phone gallery the page runs in an iframe, so it hides its own switcher bar.
const EMBEDDED = window.self !== window.top;
const SHELL_HEIGHT = EMBEDDED ? 'h-dvh' : 'md:h-[calc(100dvh-40px)]';
const ROLE_KEY = 'zuri-mock-role';
let role = window.localStorage.getItem(ROLE_KEY) === 'admin' ? 'admin' : 'user';
const isAdmin = () => role === 'admin';

const ic = (name, size = 'size-[18px]') => `<i data-lucide="${name}" class="${size} shrink-0"></i>`;

// ---------------------------------------------------------------- HeroUI-style components
const BTN_BASE = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pri md:min-h-10';
const BTN_LOOK = {
  solid: 'bg-navy text-white',
  blue: 'bg-pri text-white',
  flat: 'bg-pri-soft text-pri-ink',
  neutral: 'bg-c3 text-ink',
  light: 'text-muted hover:bg-c2',
  bronze: 'bg-bronze-soft text-bronze-ink',
  white: 'bg-white text-navy',
};
const button = (label, { look = 'solid', icon = '', attrs = '', extra = '' } = {}) =>
  `<button type="button" ${attrs} class="${BTN_BASE} ${BTN_LOOK[look]} ${extra}">${icon ? ic(icon) : ''}${label}</button>`;
const iconButton = (icon, label, { look = 'light', extra = '', attrs = '' } = {}) =>
  `<button type="button" aria-label="${label}" ${attrs} class="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pri md:size-10 ${BTN_LOOK[look]} ${extra}">${ic(icon)}</button>`;

const CHIP_LOOK = { pri: 'bg-pri-soft text-pri-ink', bronze: 'bg-bronze-soft text-bronze-ink', navy: 'bg-navy text-white', neutral: 'bg-c3 text-muted' };
const chip = (text, color = 'neutral', icon = '') =>
  `<span class="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${CHIP_LOOK[color]}">${icon ? ic(icon, 'size-3') : ''}${text}</span>`;

const AVATAR_LOOK = ['bg-pri-soft text-pri-ink', 'bg-bronze-soft text-bronze-ink', 'bg-navy text-white', 'bg-c3 text-ink'];
const avatar = (initials, tone = 0, size = 'size-9') =>
  `<span class="grid ${size} shrink-0 place-items-center rounded-full text-xs font-semibold ${AVATAR_LOOK[tone]}">${initials}</span>`;

const progress = (value, color = 'bg-pri', label = '') =>
  `<div role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}" class="h-2 w-full overflow-hidden rounded-full bg-c3"><div class="h-full rounded-full ${color}" style="width:${value}%"></div></div>`;

const card = (inner, extra = '') => `<section class="rounded-[20px] bg-c2 p-5 ${extra}">${inner}</section>`;

// Segmented control, the look of HeroUI Tabs.
const tabs = (items, active = 0, extra = '') =>
  `<div data-seg role="tablist" class="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-c2 p-1 [scrollbar-width:none] ${extra}">${items.map((label, i) =>
    `<button type="button" role="tab" aria-selected="${i === active}" data-seg-item class="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium md:min-h-8 ${i === active ? 'bg-white text-ink' : 'text-muted'}">${label}</button>`).join('')}</div>`;

const toggle = (on, label, hint = '') =>
  `<div class="flex min-h-12 items-center justify-between gap-4 py-1"><div><p class="text-sm font-medium">${label}</p>${hint ? `<p class="text-xs text-muted">${hint}</p>` : ''}</div>
   <button type="button" role="switch" aria-checked="${on}" aria-label="${label}" data-switch class="relative h-6 w-11 shrink-0 rounded-full ${on ? 'bg-pri' : 'bg-c4'}"><span class="absolute top-0.5 size-5 rounded-full bg-white ${on ? 'left-[22px]' : 'left-0.5'}"></span></button></div>`;

const field = (label, value, icon = '') =>
  `<label class="block"><span class="mb-1.5 block text-xs font-medium text-muted">${label}</span>
   <span class="flex h-12 items-center gap-2 rounded-[14px] bg-white px-3 focus-within:outline focus-within:outline-2 focus-within:outline-pri">${icon ? ic(icon, 'size-4 text-muted') : ''}<input value="${value}" class="min-w-0 flex-1 bg-transparent text-sm outline-none"></span></label>`;

const HERO_GRADIENT = 'bg-[linear-gradient(135deg,#0d1b3a_0%,#1b47b8_60%,#2f6fed_100%)]';
const pageTitle = (title, sub, actions = '') =>
  `<header class="flex flex-wrap items-end justify-between gap-4"><div><h1 class="font-display text-3xl font-extrabold tracking-tight md:text-4xl">${title}</h1><p class="mt-1 text-[15px] text-muted">${sub}</p></div><div class="flex flex-wrap gap-2">${actions}</div></header>`;

// ---------------------------------------------------------------- user shell: ChatGPT-style sidebar, no dashboard
const RECENT_CHATS = ['Launch plan outline', 'Weekly report draft', 'Budget questions', 'Client proposal notes', 'Invoice follow-up', 'Trip to Abuja'];
const PROJECTS = ['Launch plan', 'Client work', 'Learning'];

const sideRow = (icon, label, { on = false, attrs = '', trail = '' } = {}) =>
  `<button type="button" ${attrs} ${on ? 'aria-current="page"' : ''} class="flex min-h-10 w-full items-center gap-3 rounded-[12px] px-3 text-left text-sm ${on ? 'bg-pri-soft font-medium text-ink' : 'text-ink hover:bg-c2'}">${icon ? ic(icon, 'size-[18px] text-muted') : ''}<span class="min-w-0 flex-1 truncate">${label}</span>${trail}</button>`;

function accountBlock() {
  const adminItem = isAdmin()
    ? `<button type="button" data-screen="admin" class="flex min-h-11 w-full items-center gap-3 rounded-[12px] bg-bronze-soft px-3 text-left text-sm font-medium text-bronze-ink">${ic('shield-check')}Switch to admin view</button>`
    : '';
  const plain = (icon, text, attrs = '') => `<button type="button" ${attrs} class="flex min-h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-sm hover:bg-c2">${ic(icon, 'size-[18px] text-muted')}${text}</button>`;
  return `<div class="relative">
    <div data-menu class="absolute inset-x-0 bottom-full mb-2 hidden rounded-[18px] bg-white p-1.5 shadow-[0_10px_32px_rgba(13,27,58,0.18)]" role="menu">${adminItem}${plain('settings', 'Settings', 'data-screen="settings"')}${plain('circle-help', 'Help and feedback')}${plain('log-out', 'Log out')}</div>
    <button type="button" data-menu-toggle aria-haspopup="menu" class="flex min-h-14 w-full items-center gap-3 rounded-[14px] px-2 text-left hover:bg-c2">${avatar('TA', 0)}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">Tolu Adeyemi</span><span class="text-xs text-muted">${isAdmin() ? 'Admin' : 'Pro plan'}</span></span>${isAdmin() ? chip('Admin', 'bronze') : chip('Pro', 'pri')}</button></div>`;
}

function userSidebar(current) {
  const recents = RECENT_CHATS.map((title, i) => sideRow('', title, { on: current === 'chat' && i === 0, attrs: 'data-screen="chat"' })).join('');
  const projects = PROJECTS.map((name) => sideRow('folder', name)).join('');
  return `<aside aria-label="Sidebar" class="hidden w-[288px] shrink-0 flex-col gap-1 bg-white p-3 md:flex">
    <div class="flex items-center gap-2.5 px-2 pb-2 pt-1"><img src="./assets/zuri-logo.png" alt="" width="30" height="30" class="size-[30px] rounded-[9px]"><span class="font-display text-lg font-extrabold">Zuri</span><span class="ml-auto flex">${iconButton('search', 'Search chats', { extra: 'md:size-9' })}</span></div>
    ${sideRow('square-pen', 'New chat', { on: current === 'new', attrs: 'data-screen="new"' })}
    ${sideRow('list-checks', 'Tasks and reminders', { on: current === 'tasks', attrs: 'data-screen="tasks"', trail: chip('3', 'pri') })}
    <div class="min-h-0 flex-1 overflow-y-auto pt-3 [scrollbar-width:thin]">
      <p class="px-3 pb-1 text-xs font-medium text-muted">Projects</p>${projects}
      <p class="px-3 pb-1 pt-5 text-xs font-medium text-muted">Recents</p>${recents}
    </div>
    ${accountBlock()}
  </aside>`;
}

function userPhoneBar(current) {
  const items = [['new', 'message-square', 'Chat'], ['history', 'history', 'History'], ['tasks', 'list-checks', 'Tasks'], ['settings', 'settings', 'Settings']];
  if (isAdmin()) items.push(['admin', 'shield-check', 'Admin']);
  return bottomBar(items, current === 'chat' ? 'new' : current);
}

function bottomBar(items, current) {
  const buttons = items.map(([screen, icon, label]) =>
    `<button type="button" data-screen="${screen}" class="flex min-h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-full px-3 text-[11px] font-medium ${screen === current ? 'bg-pri-soft text-pri-ink' : 'text-muted'}">${ic(icon)}${label}</button>`).join('');
  return `<nav aria-label="Destinations" class="fixed inset-x-0 bottom-0 z-40 flex min-h-16 items-center justify-around bg-white px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_#e6edfa] md:hidden">${buttons}</nav>`;
}

const userShell = (current, main) =>
  `<div class="flex ${SHELL_HEIGHT}">${userSidebar(current)}<main class="min-w-0 flex-1 md:flex md:flex-col md:overflow-y-auto">${main}</main>${userPhoneBar(current)}</div>`;

// ---------------------------------------------------------------- user screens
const composer = (placeholder, extra = '') => `<div class="relative px-4 pb-24 pt-2 md:px-8 md:pb-6 ${extra}">
    <button type="button" data-jump aria-label="Jump to latest message" class="absolute -top-12 left-1/2 hidden size-11 -translate-x-1/2 items-center justify-center rounded-full bg-navy text-white md:size-10">${ic('arrow-down')}</button>
    <form data-composer class="mx-auto w-full max-w-[760px] rounded-[28px] bg-c2 p-2.5">
      <textarea rows="1" placeholder="${placeholder}" aria-label="Message" class="block min-h-10 w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-faint"></textarea>
      <div class="flex items-center gap-1">${iconButton('plus', 'Add files')}
        <button type="button" class="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-c3 md:min-h-9">${ic('shield-check', 'size-4')}Ask first</button>
        <span class="flex-1"></span>
        <button type="button" class="hidden min-h-11 items-center gap-1 rounded-full px-3 text-sm text-muted hover:bg-c3 sm:inline-flex md:min-h-9">Zuri Fast${ic('chevron-down', 'size-4')}</button>
        ${iconButton('mic', 'Voice typing')}${iconButton('arrow-up', 'Send', { look: 'solid' })}</div>
    </form>
    <p data-note class="mt-2 text-center text-xs text-faint">Zuri can make mistakes. Check important answers.</p></div>`;

function newChatScreen() {
  const ideas = ['Summarise a PDF', 'Draft an email', 'Build a budget sheet', 'Set a reminder'];
  return userShell('new', `<div class="flex min-h-[calc(100dvh-40px)] flex-1 flex-col md:min-h-0 md:h-full">
    <header class="flex min-h-14 items-center gap-3 px-4 md:px-8"><span class="font-display text-lg font-bold md:hidden">Zuri</span><span class="flex-1"></span>${iconButton('history', 'History', { attrs: 'data-screen="history"', extra: 'md:hidden' })}</header>
    <div class="flex flex-1 flex-col items-center justify-center px-4 pb-6 text-center">
      <img src="./assets/zuri-logo.png" alt="" width="56" height="56" class="mb-5 size-14 rounded-[16px]">
      <h1 class="font-display text-3xl font-extrabold tracking-tight md:text-4xl">What can I help with?</h1>
      <div class="mt-6 flex max-w-[640px] flex-wrap justify-center gap-2">${ideas.map((t) => `<button type="button" data-screen="chat" class="min-h-11 rounded-full bg-c2 px-4 text-sm font-medium text-ink hover:bg-c3 md:min-h-10">${t}</button>`).join('')}</div>
    </div>
    ${composer('Ask Zuri anything')}</div>`);
}

function chatScreen() {
  const bubble = (text) => `<div class="flex justify-end"><p class="max-w-[85%] rounded-[22px] bg-pri-soft px-4 py-3 text-[15px] leading-relaxed">${text}</p></div>`;
  const phase = (n, name, when, who) => `<li class="flex min-h-14 items-center gap-3 rounded-[14px] bg-c2 px-3.5"><span class="grid size-8 place-items-center rounded-full bg-white text-sm font-bold text-pri-ink">${n}</span><span class="min-w-0 flex-1"><span class="block text-sm font-semibold">${name}</span><span class="text-xs text-muted">${when}</span></span>${chip(who)}</li>`;
  const action = (icon, label) => iconButton(icon, label, { extra: 'md:size-8' });
  return userShell('chat', `<div class="flex min-h-0 flex-1 flex-col">
    <header class="flex min-h-14 items-center gap-3 px-4 md:px-8"><span class="text-muted">${ic('folder')}</span><h1 class="min-w-0 flex-1 truncate text-[15px] font-semibold">Launch plan outline</h1>${iconButton('history', 'History', { attrs: 'data-screen="history"', extra: 'md:hidden' })}${iconButton('share-2', 'Share')}${iconButton('ellipsis', 'More')}</header>
    <div data-thread class="px-4 pb-6 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-8"><div class="mx-auto flex w-full max-w-[760px] flex-col gap-7 pt-4">
      <p class="text-center text-xs text-faint">Today at 9:33 AM</p>
      ${bubble('Turn my launch notes into a one-page plan with dates, owners and risks.')}
      <div class="text-[15px] leading-relaxed"><p class="mb-3 text-sm text-muted">Worked for 8 seconds</p>
        <p class="mb-3">Here is a first pass. I kept it to three phases so it fits on one page, and flagged the two dates that depend on someone else.</p>
        <ul class="mb-3 flex flex-col gap-2">${phase(1, 'Prepare', '4 to 15 Nov', 'Ada')}${phase(2, 'Soft launch', '18 to 29 Nov', 'Tolu')}${phase(3, 'Public launch', '2 Dec', 'Everyone')}</ul>
        <div class="mb-2 flex items-center gap-3 rounded-[16px] bg-c2 p-3"><span class="grid size-11 place-items-center rounded-[12px] bg-pri text-white">${ic('file-spreadsheet', 'size-5')}</span><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">launch-plan.xlsx</p><p class="text-xs text-muted">Spreadsheet, 3 rows</p></div>${button('Open', { look: 'solid' })}</div>
        <div class="flex gap-0.5 text-muted" role="group" aria-label="Answer actions">${action('copy', 'Copy')}${action('thumbs-up', 'Good answer')}${action('volume-2', 'Read aloud')}${action('refresh-cw', 'Try again')}</div></div>
      ${bubble('Add a column for budget and move the soft launch a week later.')}
      <div class="text-[15px] leading-relaxed"><p class="mb-3">I need your OK before I change the file.</p>
        <div class="rounded-[16px] bg-bronze-soft p-4"><div class="flex gap-3"><span class="mt-0.5 text-bronze-ink">${ic('shield-alert')}</span><div class="min-w-0 flex-1"><p class="text-sm font-semibold text-bronze-ink">Edit launch-plan.xlsx</p><p class="mt-0.5 text-sm text-muted">Add a Budget column and move Soft launch to 25 Nov - 6 Dec.</p><div class="mt-3 flex flex-wrap gap-2">${button('Allow')}${button('Not now', { look: 'white' })}</div></div></div></div></div>
    </div></div>
    ${composer('Reply to Zuri')}</div>`);
}

function historyScreen() {
  return userShell('history', `<div class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4 pb-28 md:p-8">
    ${pageTitle('History', 'Your recent chats.')}
    <ul class="flex flex-col gap-1">${RECENT_CHATS.map((t, i) => `<li><button type="button" data-screen="chat" class="flex min-h-14 w-full items-center gap-3 rounded-[14px] px-3 text-left hover:bg-c2">${avatar(t.slice(0, 2).toUpperCase(), i % 4)}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${t}</span><span class="text-xs text-muted">${i === 0 ? '2 min ago' : i < 3 ? 'Yesterday' : 'Last week'}</span></span></button></li>`).join('')}</ul></div>`);
}

function tasksScreen() {
  const rows = [
    ['Review the launch plan', 'Today, 9:30', 'High', 'navy', 'TA', 0, false],
    ['Call Ada about the launch', 'Today, 2:00 pm', 'Medium', 'bronze', 'AO', 1, false],
    ['Send the weekly report', 'Today, 4:15 pm', 'Medium', 'bronze', 'TA', 0, false],
    ['Book the demo room', 'Thu', 'Low', 'pri', 'KE', 2, false],
    ['Pay the hosting invoice', 'Fri', 'High', 'navy', 'TA', 0, true],
    ['Update the pricing page', 'Done yesterday', 'Low', 'pri', 'KE', 2, true],
  ];
  const row = ([title, due, level, tone, who, avatarTone, done]) =>
    `<li class="flex min-h-16 items-center gap-3 rounded-[14px] px-3 hover:bg-c2"><button type="button" role="checkbox" aria-checked="${done}" aria-label="Mark ${title} done" data-check class="grid size-11 shrink-0 place-items-center md:size-9"><span class="grid size-6 place-items-center rounded-full ${done ? 'bg-pri text-white' : 'bg-c3'}">${done ? ic('check', 'size-3.5') : ''}</span></button>
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold ${done ? 'text-faint line-through' : ''}">${title}</span><span class="text-xs text-muted">${due}</span></span>
      <span class="hidden sm:block">${chip(level, tone)}</span>${avatar(who, avatarTone, 'size-8')}</li>`;
  return userShell('tasks', `<div class="mx-auto flex w-full max-w-[860px] flex-col gap-5 p-4 pb-28 md:p-8 md:pb-8">
    ${pageTitle('Tasks and reminders', '3 due today, 2 finished this week.', button('Add task', { icon: 'plus' }))}
    <div class="flex flex-wrap items-center justify-between gap-3">${tabs(['All 6', 'Today 3', 'Done 2'], 0)}<label class="flex h-11 w-full items-center gap-2 rounded-full bg-c2 px-4 sm:w-72">${ic('search', 'size-4 text-muted')}<input placeholder="Search tasks" class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"></label></div>
    <ul class="flex flex-col gap-1">${rows.map(row).join('')}</ul>
    <div class="flex items-center gap-3 rounded-[20px] bg-pri-soft p-4 text-pri-ink">${ic('sparkles', 'size-5')}<p class="flex-1 text-sm font-medium">Ask Zuri to turn a note into tasks with due dates.</p>${button('Try it', { attrs: 'data-screen="new"' })}</div>
  </div>`);
}

function settingsScreen() {
  const sections = [['user', 'General', true], ['sliders-horizontal', 'Personalisation'], ['bell', 'Notifications'], ['credit-card', 'Plan and usage'], ['database', 'Data']];
  const adminCard = isAdmin()
    ? card(`<div class="flex flex-wrap items-center gap-3"><span class="grid size-11 place-items-center rounded-[12px] bg-bronze-soft text-bronze-ink">${ic('shield-check', 'size-5')}</span><div class="min-w-0 flex-1"><p class="font-display font-bold">You are an admin</p><p class="text-sm text-muted">Open the admin area to see users, plans and usage.</p></div>${button('Switch to admin view', { look: 'bronze', attrs: 'data-screen="admin"' })}</div>`)
    : '';
  return userShell('settings', `<div class="mx-auto flex w-full max-w-[960px] flex-col gap-5 p-4 pb-28 md:p-8 md:pb-8">
    ${pageTitle('Settings', 'Make Zuri yours.')}
    <div class="grid gap-5 md:grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" class="flex gap-1 overflow-x-auto md:flex-col [scrollbar-width:none]">${sections.map(([icon, name, on]) =>
        `<button type="button" class="flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-sm font-medium ${on ? 'bg-pri-soft text-pri-ink' : 'text-muted hover:bg-c2'}">${ic(icon)}${name}</button>`).join('')}</nav>
      <div class="flex flex-col gap-4">
        ${adminCard}
        ${card(`<div class="flex items-center gap-4">${avatar('TA', 0, 'size-16')}<div class="flex-1"><p class="font-display text-lg font-bold">Tolu Adeyemi</p><p class="text-sm text-muted">tolu@example.com</p></div>${button('Change photo', { look: 'neutral' })}</div>
          <div class="mt-5 grid gap-4 sm:grid-cols-2">${field('Display name', 'Tolu Adeyemi', 'user')}${field('Email', 'tolu@example.com', 'mail')}</div>
          <div class="mt-5 flex justify-end gap-2">${button('Cancel', { look: 'light' })}${button('Save changes', { attrs: 'data-save' })}</div><p data-save-note aria-live="polite" class="mt-2 text-right text-xs text-pri-ink"></p>`)}
        ${card(`<h2 class="font-display text-lg font-bold">Personalisation</h2><p class="mb-3 text-sm text-muted">Tell Zuri how you like answers.</p>
          <textarea rows="3" aria-label="Custom instructions" class="w-full resize-none rounded-[14px] bg-white p-3 text-sm outline-none focus:outline focus:outline-2 focus:outline-pri" placeholder="For example: keep answers short and use Naira for prices."></textarea>`)}
        ${card(`<h2 class="font-display text-lg font-bold">Notifications</h2>${toggle(true, 'Reminders', 'A sound and a banner when one is due')}${toggle(true, 'Automation results', 'Tell me when a scheduled run finishes')}${toggle(false, 'Product news', 'Never more than twice a month')}`)}
        ${card(`<div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-display text-lg font-bold">Plan and usage</h2><p class="text-sm text-muted">Pro, NGN 6,000 a month</p></div>${button('Manage plan', { look: 'flat' })}</div>
          <div class="mt-4"><div class="mb-1.5 flex justify-between text-sm"><span>Tokens used</span><span class="text-muted">580k of 2m</span></div>${progress(29, 'bg-pri', 'Tokens used')}</div>`)}
      </div>
    </div>
  </div>`);
}

// ---------------------------------------------------------------- admin area (admins only): dashboard, users, plans
const ADMIN_NAV = [['admin', 'layout-dashboard', 'Overview'], ['adminUsers', 'users', 'Users'], ['', 'credit-card', 'Plans'], ['', 'cpu', 'Models'], ['', 'gauge', 'Usage'], ['', 'receipt', 'Billing']];

function adminSidebar(current) {
  const items = ADMIN_NAV.map(([screen, icon, label]) => sideRow(icon, label, { on: screen === current, attrs: screen ? `data-screen="${screen}"` : 'aria-disabled="true" title="Not in this mockup"' })).join('');
  return `<aside aria-label="Admin sidebar" class="hidden w-[272px] shrink-0 flex-col gap-3 bg-white p-3 md:flex">
    <div class="flex items-center gap-2.5 px-2 pt-1"><img src="./assets/zuri-logo.png" alt="" width="30" height="30" class="size-[30px] rounded-[9px]"><span class="font-display text-lg font-extrabold">Zuri</span>${chip('Admin', 'bronze')}</div>
    ${button('Switch to user view', { look: 'flat', icon: 'arrow-left-right', attrs: 'data-screen="new"', extra: 'w-full justify-start' })}
    <nav class="flex flex-1 flex-col gap-0.5" aria-label="Admin sections">${items}</nav>
    ${accountBlock()}
  </aside>`;
}

function adminPhoneBar(current) {
  return bottomBar([['admin', 'layout-dashboard', 'Overview'], ['adminUsers', 'users', 'Users'], ['new', 'arrow-left-right', 'User view'], ['settings', 'settings', 'Settings']], current);
}

const adminShell = (current, main) =>
  `<div class="flex ${SHELL_HEIGHT}">${adminSidebar(current)}<main class="min-w-0 flex-1 md:flex md:flex-col md:overflow-y-auto">${main}</main>${adminPhoneBar(current)}</div>`;

// A normal user who reaches an admin address sees this instead of the dashboard.
function noAccess() {
  return userShell('new', `<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 pb-28 text-center"><span class="grid size-14 place-items-center rounded-full bg-bronze-soft text-bronze-ink">${ic('lock', 'size-6')}</span>
    <h1 class="font-display text-2xl font-extrabold">This area is for admins</h1><p class="max-w-sm text-muted">Your account does not have admin access, so the dashboard is hidden. Ask an owner to give you access.</p>${button('Back to chat', { attrs: 'data-screen="new"' })}</div>`);
}

function adminScreen() {
  const bars = [46, 62, 38, 80, 58, 92, 70];
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const stat = (icon, label, big, small, extra) =>
    card(`<div class="flex items-center justify-between"><span class="grid size-10 place-items-center rounded-[12px] bg-white text-pri-ink">${ic(icon)}</span>${extra}</div><p class="mt-4 text-sm text-muted">${label}</p><p class="font-display text-3xl font-extrabold tracking-tight">${big}</p><p class="mt-1 text-xs text-muted">${small}</p>`);
  const mix = [['Starter', 42, 'bg-pri'], ['Pro', 36, 'bg-navy'], ['Power', 15, 'bg-bronze'], ['Max', 7, 'bg-c4']];
  const signups = [['AO', 'Amaka Obi', 'Starter'], ['KE', 'Kunle Ewa', 'Pro'], ['FB', 'Funmi Bello', 'Pro'], ['DI', 'David Ibe', 'Starter']];
  return adminShell('admin', `<div class="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 pb-28 md:p-8 md:pb-8">
    ${pageTitle('Overview', 'How Zuri is doing across all accounts.', `${chip('Last 7 days', 'pri')}${button('Export report', { look: 'neutral', icon: 'download' })}`)}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${stat('users', 'Active users', '1,248', '+8% on last week', chip('Live', 'pri'))}
      ${stat('messages-square', 'Messages today', '9,420', 'Peak at 2:00 pm', chip('Today'))}
      ${stat('wallet', 'Revenue this month', 'NGN 4.2m', 'Paystack, after fees', chip('On target', 'pri'))}
      ${stat('gauge', 'Token budget used', '61%', '38m of 62m tokens', chip('Watch', 'bronze'))}
    </div>
    <div class="grid gap-4 lg:grid-cols-3">
      ${card(`<div class="flex items-center justify-between"><h2 class="font-display text-lg font-bold">Messages this week</h2>${chip('Saturday busiest', 'bronze')}</div>
        <div class="mt-5 flex h-44 items-end gap-3" aria-hidden="true">${bars.map((h, i) => `<div class="flex h-full flex-1 flex-col items-center justify-end gap-2"><div class="w-full rounded-t-[8px] ${i === 5 ? 'bg-bronze' : 'bg-pri'}" style="height:${h}%"></div><span class="text-[11px] text-muted">${days[i]}</span></div>`).join('')}</div>`, 'lg:col-span-2')}
      ${card(`<h2 class="font-display text-lg font-bold">Plan mix</h2><ul class="mt-4 flex flex-col gap-4">${mix.map(([name, pct, color]) => `<li><div class="mb-1.5 flex justify-between text-sm"><span>${name}</span><span class="text-muted">${pct}%</span></div>${progress(pct, color, name)}</li>`).join('')}</ul>`)}
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      ${card(`<div class="mb-3 flex items-center justify-between"><h2 class="font-display text-lg font-bold">New sign-ups</h2>${button('All users', { look: 'light', attrs: 'data-screen="adminUsers"', extra: 'min-h-9 md:min-h-8' })}</div>
        <ul class="flex flex-col gap-1">${signups.map(([ini, name, plan], i) => `<li class="flex min-h-14 items-center gap-3 rounded-[14px] px-2">${avatar(ini, i % 4, 'size-10')}<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">${name}</span><span class="text-xs text-muted">Joined today</span></span>${chip(plan, plan === 'Pro' ? 'navy' : 'pri')}</li>`).join('')}</ul>`)}
      ${card(`<h2 class="mb-3 font-display text-lg font-bold">System</h2><ul class="flex flex-col gap-2">${[['Chat service', 'Operational', 'pri'], ['Paystack payments', 'Operational', 'pri'], ['Reminder scheduler', 'Operational', 'pri'], ['Image service', '2 retries', 'bronze']].map(([n, s, c]) => `<li class="flex min-h-12 items-center justify-between rounded-[14px] bg-white px-4 text-sm font-medium">${n}${chip(s, c)}</li>`).join('')}</ul>`)}
    </div>
  </div>`);
}

function adminUsersScreen() {
  const users = [
    ['Amaka Obi', 'amaka@example.com', 'Starter', 'pri', 22, 'Active', 'pri', 0],
    ['Kunle Ewa', 'kunle@example.com', 'Pro', 'navy', 71, 'Active', 'pri', 1],
    ['Funmi Bello', 'funmi@example.com', 'Pro', 'navy', 48, 'Active', 'pri', 2],
    ['David Ibe', 'david@example.com', 'Starter', 'pri', 93, 'Near limit', 'bronze', 3],
    ['Ngozi Eze', 'ngozi@example.com', 'Power', 'bronze', 35, 'Active', 'pri', 0],
    ['Seyi Ade', 'seyi@example.com', 'Pro', 'navy', 12, 'Past due', 'bronze', 1],
  ];
  const row = ([name, email, plan, planTone, used, status, statusTone, tone]) =>
    `<li class="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 hover:bg-c2 md:grid-cols-[minmax(0,1.6fr)_90px_minmax(0,1fr)_110px_44px]">
      <span class="flex min-w-0 items-center gap-3">${avatar(name.split(' ').map((p) => p[0]).join(''), tone, 'size-10')}<span class="min-w-0"><span class="block truncate text-sm font-semibold">${name}</span><span class="block truncate text-xs text-muted">${email}</span></span></span>
      <span class="hidden md:block">${chip(plan, planTone)}</span>
      <span class="hidden md:block">${progress(used, used > 90 ? 'bg-bronze' : 'bg-pri', name + ' tokens')}</span>
      <span class="justify-self-end md:justify-self-start">${chip(status, statusTone)}</span>
      <span class="hidden md:block">${iconButton('ellipsis', 'Actions for ' + name, { extra: 'md:size-9' })}</span></li>`;
  return adminShell('adminUsers', `<div class="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 pb-28 md:p-8 md:pb-8">
    ${pageTitle('Users', '1,248 accounts.', button('Invite user', { icon: 'user-plus' }))}
    <div class="flex flex-wrap items-center justify-between gap-3">${tabs(['All', 'Pro', 'Near limit', 'Past due'], 0)}<label class="flex h-11 w-full items-center gap-2 rounded-full bg-c2 px-4 sm:w-72">${ic('search', 'size-4 text-muted')}<input placeholder="Search by name or email" class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"></label></div>
    <div class="hidden grid-cols-[minmax(0,1.6fr)_90px_minmax(0,1fr)_110px_44px] gap-3 px-3 text-xs font-medium text-muted md:grid"><span>User</span><span>Plan</span><span>Tokens used</span><span>Status</span><span></span></div>
    <ul class="flex flex-col gap-1">${users.map(row).join('')}</ul></div>`);
}

// ---------------------------------------------------------------- public landing page
function landingScreen() {
  const feature = (icon, tone, title, text, extra = '') => `<article class="rounded-[24px] bg-c2 p-6 ${extra}"><span class="grid size-12 place-items-center rounded-[14px] ${tone}">${ic(icon, 'size-6')}</span><h3 class="mt-4 font-display text-lg font-bold">${title}</h3><p class="mt-1.5 text-sm leading-relaxed text-muted">${text}</p></article>`;
  const plan = (name, price, text, popular) =>
    `<article class="flex flex-col gap-3 rounded-[24px] p-6 ${popular ? 'bg-navy text-white' : 'bg-c2'}"><div class="flex items-center justify-between"><h3 class="font-display text-lg font-bold">${name}</h3>${popular ? '<span class="rounded-full bg-bronze px-2.5 py-0.5 text-xs font-medium text-white">Popular</span>' : ''}</div>
      <p class="font-display text-2xl font-extrabold">${price}<span class="ml-1 text-sm font-medium ${popular ? 'text-white/75' : 'text-muted'}">/month</span></p><p class="flex-1 text-sm ${popular ? 'text-white/80' : 'text-muted'}">${text}</p>${popular ? button('Choose ' + name, { look: 'white', extra: 'w-full' }) : button('Choose ' + name, { look: 'neutral', extra: 'w-full' })}</article>`;
  const link = (id, text) => `<a href="#${id}" class="hidden min-h-10 items-center rounded-full px-3 text-sm font-medium text-muted hover:bg-c2 lg:inline-flex">${text}</a>`;
  return `<div class="w-full pb-4">
    <header class="sticky top-0 z-30 w-full bg-white"><div class="mx-auto flex min-h-16 w-[calc(100%-32px)] max-w-[1200px] items-center gap-3 md:w-[calc(100%-64px)]">
      <span class="flex items-center gap-2.5"><img src="./assets/zuri-logo.png" alt="" width="32" height="32" class="size-8 rounded-[10px]"><span class="font-display text-xl font-extrabold">Zuri</span></span>
      <nav class="ml-4 flex gap-1" aria-label="Sections">${link('features', 'Features')}${link('how', 'How it works')}${link('pricing', 'Pricing')}</nav>
      <div class="ml-auto flex gap-2">${button('Sign in', { look: 'light', extra: 'hidden sm:inline-flex' })}${button('Get started', { attrs: 'data-screen="new"' })}</div></div></header>
    <section class="mx-auto grid w-[calc(100%-32px)] max-w-[1200px] items-center gap-10 py-10 md:w-[calc(100%-64px)] md:py-16 lg:grid-cols-[1.05fr_1fr]">
      <div>${chip('Your AI assistant', 'bronze', 'sparkles')}
        <h1 class="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">Ask anything. Get work <span class="text-pri">done.</span></h1>
        <p class="mt-5 max-w-[520px] text-lg leading-relaxed text-muted">Zuri chats, reads your files and builds your documents, on your desktop or in the browser. As simple as a conversation.</p>
        <div class="mt-7 flex flex-wrap gap-3">${button('Start with Zuri', { icon: 'arrow-right', extra: 'min-h-12 px-6', attrs: 'data-screen="new"' })}${button('Watch a demo', { look: 'neutral', icon: 'play', extra: 'min-h-12 px-6' })}</div>
        <ul class="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">${['One account, desktop and web', 'Pay monthly in Naira', 'See your usage live'].map((t) => `<li class="flex items-center gap-2"><span class="text-pri">${ic('circle-check', 'size-4')}</span>${t}</li>`).join('')}</ul></div>
      <div aria-hidden="true" class="rounded-[28px] bg-c2 p-3 md:p-4"><div class="overflow-hidden rounded-[20px] bg-white"><div class="flex items-center gap-1.5 bg-navy px-4 py-3"><i class="size-2.5 rounded-full bg-white/30"></i><i class="size-2.5 rounded-full bg-white/30"></i><i class="size-2.5 rounded-full bg-white/30"></i></div>
        <div class="grid grid-cols-[120px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]"><div class="flex min-h-[320px] flex-col gap-2 bg-white p-3"><div class="h-8 rounded-[10px] bg-pri-soft"></div><div class="h-3 w-4/5 rounded-full bg-c3"></div><div class="h-3 w-3/5 rounded-full bg-c3"></div><div class="h-3 w-2/3 rounded-full bg-c3"></div><div class="h-3 w-1/2 rounded-full bg-c3"></div></div>
          <div class="flex flex-col gap-3 p-4"><div class="ml-auto h-10 w-2/3 rounded-[16px] bg-pri-soft"></div><div class="flex flex-col gap-2"><div class="h-3 w-full rounded-full bg-c3"></div><div class="h-3 w-5/6 rounded-full bg-c3"></div><div class="h-3 w-2/3 rounded-full bg-c3"></div></div><div class="h-14 rounded-[14px] bg-bronze-soft"></div><span class="flex-1"></span>
            <div class="flex items-center justify-between rounded-full bg-c2 py-2 pl-4 pr-2 text-sm text-faint"><span>Ask Zuri</span><span class="grid size-8 place-items-center rounded-full bg-navy text-white">${ic('arrow-up', 'size-4')}</span></div></div></div></div></div>
    </section>
    <section id="features" class="mx-auto w-[calc(100%-32px)] max-w-[1200px] py-10 md:w-[calc(100%-64px)]"><div class="mx-auto mb-8 max-w-[620px] text-center"><p class="font-display text-sm font-bold uppercase tracking-widest text-bronze-ink">Features</p><h2 class="mt-2 font-display text-3xl font-extrabold tracking-tight md:text-4xl">Everything you need, nothing in the way</h2></div>
      <div class="grid gap-4 md:grid-cols-6">
        ${feature('message-square', 'bg-pri-soft text-pri-ink', 'Chat that keeps context', 'Pick up any conversation where you left it, on any device. Zuri can read your files and answer from them.', 'md:col-span-3')}
        ${feature('file-spreadsheet', 'bg-bronze-soft text-bronze-ink', 'Files in, documents out', 'Ask for a Word file, workbook or deck and approve every edit before it happens.', 'md:col-span-3')}
        ${feature('list-checks', 'bg-bronze-soft text-bronze-ink', 'Tasks and reminders', 'A reminder that fires on time and a task that stays put until done.', 'md:col-span-2')}
        ${feature('clock-3', 'bg-pri-soft text-pri-ink', 'Automations', 'Schedule a weekly research run and find the answer waiting.', 'md:col-span-2')}
        ${feature('gauge', 'bg-pri-soft text-pri-ink', 'Usage you can see', 'Tokens used and left, always one click away.', 'md:col-span-2')}</div></section>
    <section id="how" class="mx-auto w-[calc(100%-32px)] max-w-[1200px] py-10 md:w-[calc(100%-64px)]"><div class="grid gap-4 md:grid-cols-3">${[['1', 'Create your account', 'Sign in with Google or email.'], ['2', 'Choose a plan', 'Start small and change any time.'], ['3', 'Ask Zuri', 'Chat, draft, plan and remind.']].map(([n, t, d], i) =>
      `<div class="flex items-center gap-4 rounded-[24px] bg-c2 p-5"><span class="grid size-12 shrink-0 place-items-center rounded-full font-display text-lg font-extrabold ${AVATAR_LOOK[i]}">${n}</span><div><p class="font-display font-bold">${t}</p><p class="text-sm text-muted">${d}</p></div></div>`).join('')}</div></section>
    <section id="pricing" class="mx-auto w-[calc(100%-32px)] max-w-[1200px] py-10 md:w-[calc(100%-64px)]"><div class="mx-auto mb-8 max-w-[620px] text-center"><p class="font-display text-sm font-bold uppercase tracking-widest text-bronze-ink">Pricing</p><h2 class="mt-2 font-display text-3xl font-extrabold tracking-tight md:text-4xl">Simple monthly plans</h2><p class="mt-2 text-muted">Priced in Naira, paid through Paystack.</p></div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${plan('Starter', 'NGN 2,499', '2m tokens each month.')}${plan('Pro', 'NGN 6,000', 'More room for daily work.', true)}${plan('Power', 'NGN 15,000', 'For heavy users and small teams.')}${plan('Max', 'NGN 40,000', 'The largest allowance.')}</div></section>
    <section class="mx-auto w-[calc(100%-32px)] max-w-[1200px] md:w-[calc(100%-64px)]"><div class="flex flex-wrap items-center justify-between gap-5 rounded-[28px] ${HERO_GRADIENT} p-8 text-white md:p-10"><div><h2 class="font-display text-3xl font-extrabold tracking-tight">Ready to try Zuri?</h2><p class="mt-1 text-white/85">Create an account and ask for your first task today.</p></div>${button('Start with Zuri', { look: 'white', icon: 'arrow-right', extra: 'min-h-12 px-6', attrs: 'data-screen="new"' })}</div></section>
    <footer class="mx-auto mt-8 flex w-[calc(100%-32px)] max-w-[1200px] flex-wrap items-center gap-6 py-6 text-sm text-muted md:w-[calc(100%-64px)]"><span class="mr-auto font-display font-extrabold text-ink">Zuri</span><span>Terms</span><span>Privacy</span></footer>
  </div>`;
}

function phonesScreen() {
  const frame = (hash, label) => `<figure class="flex flex-col items-center gap-3"><div class="rounded-[44px] bg-navy p-2.5"><iframe title="${label} on a phone" src="./heroui.html#${hash}" class="block h-[780px] w-[390px] rounded-[34px] bg-white"></iframe></div><figcaption class="text-sm font-medium text-muted">${label}</figcaption></figure>`;
  const set = isAdmin()
    ? [['new', 'Chat (user view)'], ['admin', 'Admin overview'], ['adminUsers', 'Admin users']]
    : [['new', 'New chat'], ['chat', 'Conversation'], ['tasks', 'Tasks']];
  return `<div class="mx-auto w-[calc(100%-32px)] max-w-[1400px] py-8"><h1 class="font-display text-3xl font-extrabold tracking-tight">On a phone</h1><p class="mt-1 text-muted">Each frame is a real 390px wide window. The tab bar stays on screen. ${isAdmin() ? 'Showing the admin set.' : 'Showing the normal user set.'}</p>
    <div class="mt-8 flex flex-wrap justify-center gap-8">${set.map(([hash, label]) => frame(hash, label)).join('')}</div></div>`;
}

// ---------------------------------------------------------------- mount, navigation and small interactions
const SCREENS = {
  landing: { label: 'Landing', icon: 'layout-grid', render: landingScreen },
  new: { label: 'New chat', icon: 'square-pen', render: newChatScreen },
  chat: { label: 'Chat', icon: 'message-square', render: chatScreen },
  tasks: { label: 'Tasks', icon: 'list-checks', render: tasksScreen },
  settings: { label: 'Settings', icon: 'settings', render: settingsScreen },
  history: { label: '', render: historyScreen },
  admin: { label: 'Admin', icon: 'shield-check', render: () => (isAdmin() ? adminScreen() : noAccess()) },
  adminUsers: { label: '', render: () => (isAdmin() ? adminUsersScreen() : noAccess()) },
  phones: { label: 'Phones', icon: 'smartphone', render: phonesScreen },
};

function switcher() {
  if (EMBEDDED) return '';
  const tabsHtml = Object.entries(SCREENS).filter(([, s]) => s.label).map(([key, s]) =>
    `<button type="button" data-screen="${key}" data-tab class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">${ic(s.icon, 'size-[15px]')}${s.label}</button>`).join('');
  const roleButton = (value, label) => `<button type="button" data-role="${value}" aria-pressed="${role === value}" class="min-h-8 rounded-full px-3 text-xs font-semibold ${role === value ? 'bg-navy text-white' : 'text-muted'}">${label}</button>`;
  return `<div class="sticky top-0 z-50 flex h-10 items-center gap-2 bg-white px-3 shadow-[0_1px_0_#e6edfa]"><span class="hidden text-[10px] font-bold uppercase tracking-[0.12em] text-muted lg:inline">Zuri web mockups</span>
    <nav class="mr-auto flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Mockup screens">${tabsHtml}</nav>
    <div class="flex shrink-0 items-center gap-1 rounded-full bg-c2 p-0.5" role="group" aria-label="Signed in as"><span class="pl-2 pr-1 text-[11px] text-muted">Signed in as</span>${roleButton('user', 'User')}${roleButton('admin', 'Admin')}</div></div>`;
}

function mount() {
  document.getElementById('app').innerHTML = `${switcher()}${Object.entries(SCREENS).map(([key, s]) => `<div data-panel="${key}" class="hidden">${s.render()}</div>`).join('')}`;
}

function showScreen(name) {
  const target = SCREENS[name] ? name : 'landing';
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== target));
  document.querySelectorAll('[data-tab]').forEach((t) => {
    const on = t.dataset.screen === target;
    t.classList.toggle('bg-pri-soft', on);
    t.classList.toggle('text-pri-ink', on);
    t.classList.toggle('text-muted', !on);
  });
  window.scrollTo(0, 0);
  history.replaceState(null, '', `#${target}`);
  watchThread();
}

function setRole(next) {
  role = next;
  window.localStorage.setItem(ROLE_KEY, role);
  mount();
  showScreen(window.location.hash.slice(1));
  window.lucide.createIcons();
}

// The jump arrow shows only while the reader is scrolled away from the newest message.
let threadObserver = null;
function watchThread() {
  threadObserver?.disconnect();
  const panel = document.querySelector('[data-panel="chat"]:not(.hidden)');
  const thread = panel?.querySelector('[data-thread]');
  const jump = panel?.querySelector('[data-jump]');
  if (!thread || !jump) return;
  const paint = () => {
    const away = thread.scrollHeight - thread.scrollTop - thread.clientHeight > 80;
    jump.classList.toggle('hidden', !away);
    jump.classList.toggle('inline-flex', away);
  };
  thread.addEventListener('scroll', paint);
  jump.onclick = () => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  threadObserver = new ResizeObserver(paint);
  threadObserver.observe(thread);
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const menuToggle = target.closest('[data-menu-toggle]');
  document.querySelectorAll('[data-menu]').forEach((menu) => {
    const mine = menuToggle && menuToggle.parentElement.contains(menu);
    menu.classList.toggle('hidden', !(mine && menu.classList.contains('hidden')));
  });
  if (menuToggle) return;
  const nav = target.closest('[data-screen]');
  if (nav) { event.preventDefault(); showScreen(nav.dataset.screen); window.lucide.createIcons(); return; }
  const roleChoice = target.closest('[data-role]');
  if (roleChoice) { setRole(roleChoice.dataset.role); return; }
  const segItem = target.closest('[data-seg-item]');
  if (segItem) {
    segItem.closest('[data-seg]').querySelectorAll('[data-seg-item]').forEach((b) => {
      const on = b === segItem;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('bg-white', on);
      b.classList.toggle('text-ink', on);
      b.classList.toggle('text-muted', !on);
    });
    return;
  }
  const sw = target.closest('[data-switch]');
  if (sw) {
    const on = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(on));
    sw.classList.toggle('bg-pri', on);
    sw.classList.toggle('bg-c4', !on);
    const knob = sw.firstElementChild;
    knob.classList.toggle('left-[22px]', on);
    knob.classList.toggle('left-0.5', !on);
    return;
  }
  const check = target.closest('[data-check]');
  if (check) {
    const on = check.getAttribute('aria-checked') !== 'true';
    check.setAttribute('aria-checked', String(on));
    const dot = check.firstElementChild;
    dot.className = `grid size-6 place-items-center rounded-full ${on ? 'bg-pri text-white' : 'bg-c3'}`;
    dot.innerHTML = on ? ic('check', 'size-3.5') : '';
    window.lucide.createIcons();
    return;
  }
  if (target.closest('[data-save]')) {
    document.querySelector('[data-panel="settings"] [data-save-note]').textContent = 'Saved. Your settings are up to date.';
  }
});

document.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-composer]')) return;
  event.preventDefault();
  event.target.parentElement.querySelector('[data-note]').textContent = 'Zuri is ready for that. This is a mockup, so nothing was sent.';
});

window.addEventListener('hashchange', () => showScreen(window.location.hash.slice(1)));
document.addEventListener('DOMContentLoaded', () => {
  mount();
  showScreen(window.location.hash.slice(1));
  window.lucide.createIcons();
});
