## 2026-10-24 - Windows

- Added server-side free-plan guardrails with per-user request rate, concurrency, prompt-size limits, and a protected limits endpoint. Monthly token quota remains backed by PostgreSQL usage events.
- Key files: `server/src/limits.js`, `server/src/app.js`, `server/test/server.test.js`, `server/README.md`.
- Other OS action: run `npm install --prefix server && npm --prefix server test` after syncing.
- Done on: Windows

- Added a Zuri Cloud signup screen that explicitly supports Gmail and verified Google Workspace accounts from company, school, and custom domains. The account normalizer also has regression coverage for a non-Gmail domain.
- Key files: `src/renderer-react/SignUpView.jsx`, `src/renderer-react/App.jsx`, `src/renderer-react/FeaturesView.jsx`, `src/renderer-react/Icons.jsx`, `server/test/server.test.js`.
- Other OS action: run `npm install --prefix server && npm test` after syncing.
- Done on: Windows

- Added a confirmed Clear all history action to Chat history. It uses one locked store operation, clears all saved threads, refreshes the view, and announces the change to other open views.
- Key files: `src/main/store.js`, `src/main/main.js`, `src/main/preload.js`, `src/renderer-react/HistoryView.jsx`.
- Other OS action: run `npm run react:build && npm test` after syncing.
- Done on: Windows

- Added Google identity verification, hashed bearer sessions, PostgreSQL user/subscription/usage repository methods, and protected account endpoints to the Railway package.
- Key files: `server/src/auth.js`, `server/src/db.js`, `server/src/app.js`, `server/src/server.js`, `server/test/server.test.js`, `server/package.json`.
- Other OS action: run `npm install --prefix server && npm --prefix server test`.
- Done on: Windows

- Web search is now enabled by default for new users. An explicit saved off choice is preserved, and the setting remains available in the composer menu.
- Key file: `src/renderer-react/ChatPanel.jsx`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

- Completed Office integration: uploaded DOCX, XLSX and PPTX files can be edited into new copies, and Windows users can install or remove a local HTTPS Word add-in from Settings. The add-in registers a per-user manifest, trusts its localhost certificate, resumes its server while Zuri runs, and keeps provider keys in the main process.
- Key files: `src/main/office-edit.js`, `src/main/addin.js`, `src/addin/taskpane.html`, `src/addin/taskpane.js`, `src/renderer-react/SettingsView.jsx`, `src/main/main.js`, `src/main/preload.js`.
- Other OS action: run `npm install && npm run test` after syncing.
- Done on: Windows

- Chat can now search the web and read pages (DeepSeek and other OpenAI-style providers) through a tool loop capped at 4 rounds, only when the "Search the web" switch in the composer + menu is on (remembered between restarts, off by default). The + menu also gained "Add folder" (reads up to 20 top-level text files, 100 KB each, 200,000 characters total) and slash commands that fill the box with a starter sentence. The quick-ask overlay got Close and Open Zuri buttons and a sidebar button, and a Features page was added.
- Key files: `src/main/providers/chat.js`, `src/main/main.js`, `src/main/preload.js`, `src/main/store.js`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/Icons.jsx`, `src/renderer-react/App.jsx`, `src/renderer-react/Sidebar.jsx`, `src/renderer-react/FeaturesView.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Kept the chat composer typeable while a reply is running. It was disabled until the reply finished, so a slow provider locked typing for up to two minutes. Sending stays blocked mid-reply and the half-typed message is kept.
- Key file: `src/renderer-react/ChatPanel.jsx`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Rebuilt the Tasks, Reminders, Automations, Settings, Office files and AI agents pages on one shared frame: a title and description on every page, one card per section, centred 1200px content, one 44px control height for fields and buttons, one centred empty state, and quiet red text actions for delete. The Chat and Work landing now carries its mode switch above the headline, four pressable tool cards with icons, and suggestions as chips instead of text lines. The assistant is also told the current date and time, so it no longer refuses questions like "what day is it".
- Key files: `src/renderer-react/app.css`, `src/renderer-react/ui.jsx`, `src/renderer-react/TasksView.jsx`, `src/renderer-react/RemindersView.jsx`, `src/renderer-react/AutomationsView.jsx`, `src/renderer-react/SettingsView.jsx`, `src/renderer-react/FilesView.jsx`, `src/renderer-react/AgentsView.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/main/providers/chat.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Reworked dark mode into a navy palette and made every text element readable: Ghost buttons, field labels, checkbox labels, and the selected agent row now take their colour from the shared theme tokens instead of Flowbite dark variants that this build never generates. Field labels render again (Flowbite's Label ignores the `value` prop), unchecked checkboxes follow the theme colour scheme, and the calendar icon sits inside its date field.
- Key files: `src/renderer-react/app.css`, `src/renderer-react/ui.jsx`, `src/renderer-react/SelectField.jsx`, `src/renderer-react/AgentsView.jsx`, `src/renderer-react/SettingsView.jsx`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Made the composer assistant-mode control icon-only, removing its visible oval while preserving the accessible label, tooltip, and dropdown options.
- Key files: `src/renderer-react/SelectField.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Expanded the React chat pane to the available width with side padding, wrapped long unbroken messages, lowered the in-chat composer, and hid the conversation scrollbar while preserving scrolling.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Changed the chat composer keyboard behavior so Enter sends and Shift+Enter inserts a newline, while IME composition remains safe.
- Key file: `src/renderer-react/ChatPanel.jsx`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Added working voice-to-text dictation to the composer using browser-native speech recognition, with start/stop state, transcript insertion, useful microphone errors, and audio-only permission handling for the local renderer.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/main/main.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Normalized shared Flowbite controls to the Zuri semantic palette, pill actions and chips, compact dropdown items, theme-aware fields, and taller date/time inputs.
- Key files: `src/renderer-react/ui.jsx`, `src/renderer-react/SelectField.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Constrained Flowbite dropdown menus to compact content-sized panels instead of stretching across the composer.
- Key files: `src/renderer-react/SelectField.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Added a dedicated Chat history view with continue and confirmed permanent delete actions for every saved conversation.
- Key files: `src/renderer-react/HistoryView.jsx`, `src/renderer-react/App.jsx`, `src/renderer-react/Sidebar.jsx`, `src/main/preload.js`, `src/main/main.js`, `src/main/store.js`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Increased Settings input and dropdown heights and replaced nearly invisible hairlines with clearer theme-aware borders and focus rings.
- Key files: `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Strengthened the New chat sidebar hover state with a dedicated tinted surface, clearer contrast, and a larger hit area.
- Key files: `src/renderer-react/Sidebar.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Added more breathing room to the empty-chat suggestion list with a larger card inset, taller rows, and consistent row gaps.
- Key files: `src/renderer-react/ChatPanel.jsx`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Increased light-theme surface contrast and added a dedicated blue-tinted selected state for active tabs, navigation, secondary buttons, and dropdown triggers.
- Key files: `src/renderer-react/app.css`, `src/renderer-react/ui.jsx`, `src/renderer-react/Sidebar.jsx`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Added an English-first response policy to chat and document provider prompts, allowing other languages only after an explicit user request and preventing accidental mixed-language replies.
- Key files: `src/main/providers/chat.js`.
- Other OS action: run `npm run build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Replaced shared native-looking select fields with Flowbite Dropdown menus, changed task deletion to a Lucide close icon, and made the composer send action a circular accent button.
- Key files: `src/renderer-react/SelectField.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/TasksView.jsx`, `src/renderer-react/Icons.jsx`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Moved the sidebar collapse control into the top conversation header and replaced the bottom chevron with Lucide panel close/open icons.
- Key files: `src/renderer-react/Sidebar.jsx`, `src/renderer-react/Icons.jsx`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Replaced remaining hairline panel borders with transparent separation and soft theme-aware shadows, refreshed the light and dark surface tokens, and made Flowbite dark variants follow the app theme toggle.
- Key files: `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Registered the custom Tailwind theme colors so the dark renderer has readable contrast, and replaced local SVG navigation icons with Lucide React icons.
- Key files: `src/renderer-react/app.css`, `src/renderer-react/Icons.jsx`, `package.json`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Replaced nested Flowbite field boxes with compact, borderless pill controls and regenerated the Windows ICO from the current blue Zuri bubble asset.
- Key files: `src/renderer-react/ui.jsx`, `src/renderer-react/SelectField.jsx`, `src/renderer-react/app.css`, `src/main/assets/zuri-icon.ico`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Fixed the Windows taskbar identity so the app sets its AUMID before launch and refreshes stale development shortcuts with the Zuri ICO instead of leaving Electron's icon cached.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Connected the composer attachment button to the native file picker, added supported-format guidance and a removable attachment chip, and included readable attachment text in the chat request.
- Key files: `src/renderer-react/ChatPanel.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Removed the rounded selected-pill background from the Agents list and replaced it with a flat selected row using a left rule and accent text.
- Key files: `src/renderer-react/AgentsView.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Applied Flowbite-native styling to shared React inputs, textareas, selects, labels, and checkbox text, including dark-mode variants driven by the app theme.
- Key files: `src/renderer-react/ui.jsx`, `src/renderer-react/SelectField.jsx`, `src/renderer-react/App.jsx`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Widened and aligned Work mode so its tool cards, composer, and suggestions share one responsive content rail; equalized the card columns and spacing.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Made the Flowbite composer a growing multiline textarea with hidden scrollbars and kept Enter available for new lines; changed the sidebar collapse control to an up/down chevron.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/ui.jsx`, `src/renderer-react/Sidebar.jsx`, `src/renderer-react/Icons.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm install && npm run react:build` after syncing.
- Done on: Windows

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

## 2026-10-24 - Windows

- Restored the shared Flowbite pill treatment on page inputs by styling the visible TextInput element instead of its transparent wrapper.
- Key files: `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Constrained the chat composer, removed the suggestion card shell, randomized three common prompts, restored the selected mode label beside its chevron, and hid the chat and sidebar scrollbars while keeping scrolling enabled.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/SelectField.jsx`, `src/renderer-react/Sidebar.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Audited React page shells for inconsistent gutters and native date controls, added one shared page spacing contract, and replaced reminder and automation calendar inputs with Flowbite Datepicker controls plus shared time inputs.
- Key files: `src/renderer-react/ui.jsx`, `src/renderer-react/app.css`, `src/renderer-react/RemindersView.jsx`, `src/renderer-react/AutomationsView.jsx`, `src/renderer-react/AgentsView.jsx`, `src/renderer-react/FilesView.jsx`, `src/renderer-react/HistoryView.jsx`, `src/renderer-react/SearchView.jsx`, `src/renderer-react/SettingsView.jsx`, `src/renderer-react/TasksView.jsx`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Changed shared Flowbite fields and dropdowns from full pills to consistent rounded boxes, restored horizontal control padding, and made the Reminders form use a responsive grid for aligned fields and actions.
- Key files: `src/renderer-react/app.css`, `src/renderer-react/ui.jsx`, `src/renderer-react/SelectField.jsx`, `src/renderer-react/RemindersView.jsx`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Raised the shared Flowbite dropdown menu above the chat suggestions so all mode options remain visible when the menu is open.
- Key files: `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Refreshed the shared Flowbite page language with consistent rounded cards, form surfaces, field labels, list rows, responsive gutters, hover states, and lighter elevation across the remaining destinations.
- Key files: `src/renderer-react/app.css`, `src/renderer-react/ui.jsx`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Added a dedicated compact React render for the floating overlay and constrained its transparent window, composer, transcript, and document overflow so it no longer renders the full desktop shell or native scrollbars.
- Key files: `src/renderer-react/App.jsx`, `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/app.css`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Fixed the Flowbite calendar grid, tightened page form and list widths, improved empty states and agent editor alignment, and made the floating assistant open larger and resize freely with the transcript using the available height.
- Key files: `src/renderer-react/app.css`, `src/renderer-react/ui.jsx`, `src/renderer-react/RemindersView.jsx`, `src/renderer-react/TasksView.jsx`, `src/renderer-react/AgentsView.jsx`, `src/main/overlay.js`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-23 - Windows

- Added the zero-cost chat improvements without a new package or provider call: a Stop button replaces Send while a reply streams, every assistant message has a Copy button, and the transcript follows the newest message unless the reader has scrolled up. Search now reads the full text of every saved conversation and shows the matching snippet with the hit highlighted, and Enter opens the first result. Answers render http(s) links (bare or Markdown style) in the default browser, simple pipe tables, and fenced code blocks with a language label and Copy button; ordered and unordered lists show their numbers and bullets again.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/SearchView.jsx`, `src/renderer-react/FormattedMessage.jsx`, `src/renderer-react/clipboard.js`, `src/renderer-react/Icons.jsx`, `src/renderer-react/App.jsx`, `src/renderer-react/app.css`, `src/main/main.js`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows
## 2026-10-24 - Windows

- Started the separate Railway Zuri Cloud package with health and plan endpoints, Nigerian NGN plan definitions, quota calculation helpers, and a PostgreSQL schema for users, sessions, subscriptions, usage events, and Paystack payments.
- Key files: `server/package.json`, `server/src/app.js`, `server/src/plans.js`, `server/src/usage.js`, `server/src/server.js`, `server/db/schema.sql`, `server/test/server.test.js`.
- Other OS action: run `npm --prefix server test`.
- Done on: Windows
