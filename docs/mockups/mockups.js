const root = document.documentElement;
const navItems = [...document.querySelectorAll('[data-screen]')];
const panels = [...document.querySelectorAll('[data-screen-panel]')];

function showScreen(screen) {
  navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.screen === screen));
  panels.forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.screenPanel === screen));
  history.replaceState(null, '', `#${screen}`);
}

navItems.forEach((item) => item.addEventListener('click', () => showScreen(item.dataset.screen)));

document.querySelector('[data-theme-toggle]')?.addEventListener('click', (event) => {
  const dark = root.dataset.theme === 'dark';
  root.dataset.theme = dark ? 'light' : 'dark';
  event.currentTarget.textContent = dark ? 'Light' : 'Dark';
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const label = button.dataset.action === 'add-task' ? 'New task ready to add.' : 'Zuri is ready for that.';
    const note = document.querySelector('[data-form-note]');
    if (note) note.textContent = label;
    button.classList.add('is-confirmed');
    window.setTimeout(() => button.classList.remove('is-confirmed'), 700);
  });
});

document.querySelectorAll('.mock-choice-grid button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.mock-choice-grid button').forEach((item) => item.classList.remove('is-selected'));
    button.classList.add('is-selected');
  });
});

document.querySelector('[data-settings-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const note = event.currentTarget.querySelector('[data-form-note]');
  if (note) note.textContent = 'Your workspace is ready to go.';
});

const initialScreen = window.location.hash.slice(1);
showScreen(['overview', 'chat', 'tasks', 'settings'].includes(initialScreen) ? initialScreen : 'overview');
