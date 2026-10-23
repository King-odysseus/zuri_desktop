## 2026-10-23 - Windows

- Migrated the React renderer from HeroUI components to Flowbite React components through shared Flowbite-backed controls, including buttons, badges, checkboxes, fields, textareas, selects, and shell controls.
- Key files: `package.json`, `package-lock.json`, `src/renderer-react/ui.jsx`, `src/renderer-react/app.css`, `src/renderer-react/SelectField.jsx`, and all React page views.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Fixed React assistant message formatting, corrected the literal apostrophe in the chat heading, made the Ask/Act/Autopilot selector compact and borderless, and kept the composer placeholder as Ask Zuri in every workspace mode.
- Key files: `src/renderer-react/FormattedMessage.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/SelectField.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Made Work mode a functional work hub with quick links to Tasks, Files, Reminders, and Automations while keeping the Zuri composer available.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/App.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Connected the React composer to the existing Zuri chat bridge with persisted threads, streamed replies, visible errors, reopenable Recents, New chat reset, and a collapsible sidebar.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/Sidebar.jsx`, `src/renderer-react/App.jsx`, `src/renderer-react/Icons.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Added Chat and Work workspace modes, a visible dark-mode toggle, and a full-width Search page route in the React shell.
- Key files: `src/renderer-react/App.jsx`, `src/renderer-react/Sidebar.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/SearchView.jsx`, `src/renderer-react/Icons.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Improved assistant response formatting with safe Markdown blocks and responsive styles.
- Key files: `src/renderer/ui/composer.js`, `src/renderer/styles/components.css`, `scripts/selftest.js`.
- Other OS action: no build required; run `npm test` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Polished the React shell with a slimmer icon rail, roomier conversation panel, compact mode selector, and layered navy surfaces; rebuilt and installed the React desktop app.
- Key files: `src/renderer-react/Sidebar.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Replaced all remaining native React dropdowns with the shared HeroUI Select and ListBox field, including the chat mode, reminders, automations, settings theme/provider, and allow-list controls.
- Key files: `src/renderer-react/SelectField.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/RemindersView.jsx`, `src/renderer-react/AutomationsView.jsx`, `src/renderer-react/SettingsView.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Removed narrow max-width page shells from Tasks, Reminders, Agents, Automations, Files, and Settings so content fills the available window while using responsive mobile padding.
- Key files: `src/renderer-react/TasksView.jsx`, `src/renderer-react/RemindersView.jsx`, `src/renderer-react/AgentsView.jsx`, `src/renderer-react/AutomationsView.jsx`, `src/renderer-react/FilesView.jsx`, `src/renderer-react/SettingsView.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Reworked the main sidebar surface to navy in dark mode and increased navigation button spacing to 8px.
- Key files: `src/renderer/styles/components.css`, `src/renderer/styles/tokens.css`, `scripts/smoke.js`, `scripts/selftest.js`.
- Other OS action: no build required; run `npm test` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Simplified the composer into a single expanding rounded field, moved mode selection behind one dropdown trigger, and added a navy composer surface for dark mode.
- Key files: `src/renderer/styles/components.css`, `src/renderer/styles/tokens.css`.
- Other OS action: no build required; run `npm test` after syncing.
- Done on: Windows
## 2026-10-23 - Windows

- Refined the shell sidebar brand mark to the 32px design geometry and increased collapse-control contrast.
- Key files: `src/renderer/index.html`, `src/renderer/styles/components.css`, `src/renderer/styles/tokens.css`.
- Other OS action: no build required; run `npm test` after syncing.
- Done on: Windows
