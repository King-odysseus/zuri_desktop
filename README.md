# Zuri Desktop

Zuri is a local AI command centre for Windows. One window holds a sidebar of views, a chat in the
middle and a context panel on the right. It keeps its own data on this machine, sends a message to
an AI provider only when you write one, and can run scheduled work while it is open.

This file documents the local development workflow: how to install and run it, what each script
does, and where Zuri keeps your data and your API keys on disk.

## Quick start

The seven commands a local checkout needs, in the order you reach for them:

```
npm install             # once per checkout: downloads Electron
npm start               # opens the Zuri window
npm run smoke           # boots the real window, confirms the shell renders, exits 0
npm run selftest        # no-window checks: store, keys, provider, tools, scheduler, views
npm run firstrun        # runs the first-run setup with no window and asserts what it stored
npm run demo:act        # scripted Act run: searches, saves a summary, checks it is listed
npm run demo:autopilot  # scripted Autopilot run: fires a run, then checks the catch-up
```

All seven run today. The two demo commands are the executable form of the stories they cover: they
drive the real tool layer and the real scheduler against a scratch data folder, so a demo run cannot
touch your own tasks, reminders or workspace. What each one does is described under "The two demo
scripts" below, and `npm test` runs both.

## Requirements

- Windows 10 or 11. The app targets Windows only.
- Node.js 20 or newer (checked against Node 20.17).
- npm, which comes with Node.

There is no build step. The renderer is plain HTML, CSS and JavaScript, so nothing is compiled and
`npm install` is the only setup. Electron 41 is the sole dependency, installed as a dev dependency.

## Install

```
npm install
```

That downloads Electron into `node_modules`. Without it, `npm start` stops with a missing `electron`
module error, so run the install first on a fresh checkout.

## Run the app

```
npm start
```

Opens the Zuri window against the data folder described in "Where your data lives" below.

## Commands

Every script in `package.json`. The seven from the quick start come first; the rest are helpers.

| Command | Status | What it does |
| --- | --- | --- |
| `npm install` | ready | Installs Electron. Required once per checkout. |
| `npm start` | ready | Launches the desktop app. |
| `npm run smoke` | ready | Boots the real main process and window, confirms the three-column shell renders and that there are no console errors, then exits 0 on success and 1 on failure. |
| `npm run selftest` | ready | Node-only checks with no window: store round-trip and atomic write, where the key file lands and that no store file ever holds a key, chat streaming against a stub provider, tool allow-list refusal, scheduler due-detection, and the markup and design checks for each view. Prints PASS, FAIL or SKIP per check. |
| `npm run firstrun` | ready | Runs the first-run setup code with no window, in a scratch folder, and asserts the stored `settings.json` has the name and theme and that the API key went to `secrets.json` instead of `settings.json`. |
| `npm run demo:act` | ready | Runs one scripted Act request with no window, in a scratch folder: it searches, fetches a page, summarises it, saves a Markdown file into the workspace, and asserts the file appears in the Files listing and that an unconfirmed write over it does not run. |
| `npm run demo:autopilot` | ready | Schedules an automation in a scratch folder, waits for the scheduler to run it, asserts the run raised a notification and left a follow-up reminder, then restarts in a second process and asserts exactly one catch-up run. |
| `npm run dev` | ready | Serves the renderer at `http://127.0.0.1:5173/` and starts Electron against it with DevTools enabled. Closing the window stops both. |
| `npm run preview` | ready | Serves the renderer in a browser and prints the URL. The bridge does not exist in a browser, so views that call it degrade; useful for looking at layout and tokens. |
| `npm test` | ready | Runs `smoke`, `selftest`, `firstrun`, `demo:act` and `demo:autopilot`. This is the project check. |
| `npm run icon` | ready | Redraws the window icon PNG from the logo SVG. |
| `npm run dist` | ready | Builds the Windows installer into `release/`. See "Build the Windows installer" below. |

`smoke` and `firstrun` are launched through Electron (`electron scripts/smoke.js` and
`electron scripts/firstrun.js`), so each starts a real app process and stops it again when the
check ends. `selftest`, `demo:act` and `demo:autopilot` are plain Node and need no window, which is why
`selftest` is the fast one to run while changing `src/main`. `npm test` runs all five in that order
and stops at the first failure, so the first failing line is the one to read.

### The two demo scripts

Both follow the same rule as every other check: a demo runs against a scratch copy of the data
folder under `%TEMP%`, so it never writes into `%APPDATA%\Zuri`. Each one does this:

- `npm run demo:act` drives one scripted Act prompt end to end: it searches, fetches a page,
  summarises it, saves a Markdown file into the workspace, confirms the file appears under Files,
  and asserts that an unconfirmed `writeFile` over a file that already exists does not run. Every
  step goes through the real tool layer; only the model call is stood in for, by an extractive
  summariser, so no API key is needed. The search is live when there is a network and falls back
  to a saved results page when there is not; set `ZURI_DEMO_OFFLINE=1` to skip the live attempt.
- `npm run demo:autopilot` schedules one automation, waits for the scheduler to run it, asserts the
  run raised a notification and left a follow-up reminder, then starts a second process and
  asserts that exactly one catch-up run happens rather than one per missed interval. The run is
  made to fail a step on purpose (its allowed tools leave out the tool it needs), because a run
  only leaves a follow-up reminder when it needs attention. It is the executable form of the rule
  in "Autopilot runs only while Zuri is open".

## Build the Windows installer

```
npm run dist
```

The installer is written to `release\Zuri-<version>-Setup.exe` (for this version,
`release\Zuri-0.1.0-Setup.exe`), next to an unpacked copy of the app in
`release\win-unpacked`. `release/` is gitignored, so a build never lands in the repository.

The packaging setup is the `build` block of `package.json`: one Windows NSIS target for x64, the icon
at `src/main/assets/zuri-icon.ico`, and a file list of `src/main` and `src/renderer` only. Nothing
else is copied, so the checks in `scripts/` and the plan in `.kai/` never ship inside the app. The
installer is per-user (no admin prompt), lets you choose the install folder, and creates Start menu
and desktop shortcuts; uninstalling it leaves your data alone.

The first build downloads electron-builder's own tooling (the NSIS compiler and its archive helpers)
into `%LOCALAPPDATA%\electron-builder\Cache`, so it needs a network connection and a few minutes.
Later builds reuse that cache and take about a minute. Close Zuri first, including a copy started from
`release\win-unpacked`: the build deletes that folder before it repacks, and Windows refuses to
delete files a running app still has open.

The icon is one drawing everywhere: `src/main/assets/zuri-icon.png` for the window and the
notification area, and `src/main/assets/zuri-icon.ico` for the built `Zuri.exe`, the installer, the
uninstaller and the setup window's header. The `ico` is rasterised from the logo by `npm run icon`,
so it cannot drift from the logo the app draws. If a build ever shows the Electron atom instead of
the Zuri mark, the step that writes the icon into the exe did not run: read the build log for a
`winCodeSign` line rather than looking at the icon code, because the configuration is fine and the
tooling failed.

Two failures are worth knowing because neither names the icon:

- `Cannot create symbolic link` while unpacking `winCodeSign` happens when that archive's macOS
  symlinks meet Windows without Developer Mode. The tools are still extracted, so copying the
  extracted folder to `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign-2.6.0` lets the build
  continue.
- `Cannot open the file as [7z] archive` on the installer step means a file in `release` was locked
  while it was written, usually by a Zuri or `7za` process left from an earlier run. Close it, delete
  `release`, and build again.

The build is not code signed. Windows SmartScreen therefore shows "Unknown publisher" the first time
the installer runs; that is expected for a local build, not a failure.

The installed app uses the same data folder as the dev checkout, `%APPDATA%\Zuri`, described in
"Where your data lives" below. Installing over a checkout therefore keeps your chats, tasks and
workspace, and the first-run setup only appears when that folder has no settings yet.

## Where your data lives

Zuri pins its application name to `Zuri`, so Electron's user data folder, the one every path below
hangs off, is:

```
%APPDATA%\Zuri
```

In full, on a typical machine: `C:\Users\<you>\AppData\Roaming\Zuri`.

| Path | Contents |
| --- | --- |
| `%APPDATA%\Zuri\zuri\` | The JSON store: `chats.json`, `tasks.json`, `reminders.json`, `schedules.json`, `runs.json`, `notifications.json`, `settings.json`. |
| `%APPDATA%\Zuri\zuri\secrets.json` | Provider API keys. See "API keys" below. |
| `%APPDATA%\Zuri\workspace\` | The workspace, the only folder Act writes files into. Created on first launch so the Files view can list an empty folder instead of reporting a missing one. |

Note the nested name: the JSON store sits in a `zuri` subfolder, so the full path contains both
`Zuri` and `zuri`.

Nothing is written into the repository. Every store file is written atomically (a temp file, then a
rename), so a crash during a save cannot truncate your task list.

The checks never touch these folders. `selftest`, `firstrun` and `smoke` write into throwaway
folders under `%TEMP%` instead, each named after the check that owns it: `zuri-smoke-<random>`
(store and workspace), `zuri-profile-<random>` (the Electron profile the smoke run boots with),
`zuri-store-<random>`, `zuri-workspace-<random>`, `zuri-listing-<random>`, `zuri-files-<random>`
and `zuri-firstrun`. `smoke` and `firstrun` delete their own folders when they finish, and
`firstrun` empties `zuri-firstrun` before it starts, so every run begins with nothing stored. The
`selftest` folders are left behind after a run, and deleting any of them is always safe.

The "Open data folder" button in Settings opens the JSON store folder, `%APPDATA%\Zuri\zuri`, in
Explorer.

## API keys

- Enter a key once in Settings, for OpenAI or Anthropic.
- It is stored in `%APPDATA%\Zuri\zuri\secrets.json`, written by the main process only.
- The key never crosses into the window. The window can set a key, clear it, and ask whether one
  exists; it gets a yes or no back, never the key itself. Settings shows "Key saved" or "No key
  saved", never the key.
- Provider calls read the key in the main process, in the adapter at `src/main/providers/chat.js`.
- `secrets.json` is listed in `.gitignore`, so a checkout cannot carry a real key. Do not commit a
  key by any other route either.

## Ask, Act and Autopilot

The composer has three modes:

- **Ask** answers questions and changes nothing.
- **Act** can use the tools: search and fetch pages, read and write files, summarize a document,
  open a URL, and launch a named application. Files are written only inside the workspace; reads may
  open a file you picked in the file dialog. Launching an application or opening a website is
  refused until you add that application or URL under Settings, so both allow-lists start empty and
  a fresh install can launch nothing. Steps that overwrite a file or launch an app ask for
  confirmation first.
- **Autopilot** runs stored prompts on a schedule. See the next section.

## Autopilot runs only while Zuri is open

**Autopilot runs only while Zuri is open, and a catch-up runs once on the next launch.** Zuri
installs no background service and no Windows scheduled task, so scheduled work runs inside the app
and nothing runs after you close the window. Whatever came due while Zuri was closed is caught up
once when you open it again: each automation runs a single time, however many intervals it missed,
instead of firing once per missed interval.

Status today:

- Reminders follow this rule. They tick every ten seconds while the app is open, and the first tick
  at launch is the catch-up sweep for reminders that came due while it was closed.
- Automations follow it too. `src/main/scheduler.js` ticks every 30 seconds, runs what is due, and
  records each run in `runs.json`; the Automations view reads that live history rather than a copy.
  The sweep on launch runs each overdue automation once and reports how many it ran, and a
  "Caught up N runs" notice appears over the composer when that number is above zero.
- `npm run demo:autopilot` is the executable form of this rule: it starts a real run, checks the
  notification and the follow-up reminder, then restarts in a second process and asserts that ten
  missed turns produce exactly one catch-up run, not ten.

## First run

There is no forced setup screen yet. The setup code that writes your name, theme and provider key
lives in `src/main/onboarding.js`, and `npm run firstrun` runs that same code with no window to
prove it stores what it should.

## Out of scope for this release

- Cloud sync and any account you log into from another machine.
- A background service or Windows scheduled task. Autopilot needs the app to be open.
- A remote database. All data is the JSON files above, on this machine.
- macOS and Linux builds. The installer target is Windows only.
- Authoring Word, Excel or PowerPoint files, and typing into other applications. Act can read an
  Office document, summarize it and open an allow-listed app, but it does not drive the desktop.

## Project layout

```
src/main/       main process: window, IPC bridge, store, secrets, tools, scheduler, reminders, overlay
src/renderer/   the window: index.html, styles/ (tokens and components), ui/ (shell, router, top bar), views/
scripts/        checks and helpers with no dependencies of their own
.kai/           the plan file the agent workflow keeps for this project
```

The main process is the only side that touches the disk or a provider key. The renderer reaches it
through the narrow bridge in `src/main/preload.js`, and only the channels main registers are
answered.

## Troubleshooting

- **`npm start` says it cannot find `electron`.** Run `npm install` first.
- **You need to inspect the window.** Run `npm run dev`, which opens Electron with DevTools, or set
  `ZURI_DEVTOOLS=1` before `npm start`.
- **A check fails and you want to see it fail.** Each check prints one line per assertion; a failure
  names what it saw.
- **Reminders stay silent.** Windows notification permissions decide whether they appear; allow Zuri
  in Settings, System, Notifications.
