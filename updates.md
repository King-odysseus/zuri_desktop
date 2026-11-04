## 2026-11-04 - Windows (selection reads fall back across Office builds)

- The first selection-aware build still left some real Office sessions without a target. Word can expose a whole-table selection as a plain range, and PowerPoint can throw while asking for selected text when the selection is a shape or slide.
- Word now enumerates up to 20 document tables and matches the selected text against their bounded cell contents when the parent-table property is empty. PowerPoint text coercion is now guarded, so a non-text selection continues into slide and shape metadata instead of setting the pane to "The file could not be read".
- Added self-test assertions for the table fallback and guarded selection probe.
- Key files: src/addin/taskpane.js, scripts/selftest.js.
- Other OS action: rebuild and reinstall the desktop app before testing the updated pane in Office.
- Done on: Windows

## 2026-11-04 - Windows (Office edits now follow selected slides, shapes and tables)

- The Office pane used selected text as its only selection signal. Selecting a PowerPoint shape, slide, or table can have no text, so the model could not identify the target and the read could fall back to the generic file error. Word table selections had the same blind spot because only selection text was loaded.
- PowerPoint context now reads selected slide and shape collections when PowerPointApi 1.5 is available, including shape name, type and text. PowerPoint writes can target the live selected shape with the selected, selection or current shape alias, while older Office builds keep the existing text-only path.
- Word context now reports the containing table, its dimensions and bounded cell contents through parentTableOrNullObject when WordApi 1.3 is available. Optional PowerPoint metadata failures fall back to the existing selected-text context instead of blanking the read.
- Added self-test coverage for the selection-aware readers and target path. `node scripts/selftest.js` passes.
- Key files: src/addin/taskpane.js, src/addin/intelligence.js, scripts/selftest.js.
- Other OS action: none beyond the usual. The add-in ships inside the desktop app, so rebuild the installer before testing in Office.
- Done on: Windows

## 2026-11-04 - Windows (the Office pane says it is working, and can improve a prompt)

- The Office pane drew an empty reply row while a request was in flight, so there was no sign of thinking, streaming or connection. The row was meant to read "Thinking...", but the check it used never fired: an empty reply splits into one blank text segment rather than no segments, so counting segments painted nothing. The row is now judged by what it actually drew.
- A waiting reply row now carries three moving dots and names the step in words ("Thinking...", then whatever the server reports, such as "Reading the contract..."). The status line under the composer also fills that row, because an 11.5px grey line is easy to miss.
- A dot beside the app's name says whether the pane is connected: amber while Office has not named the app, dark and pulsing while a request runs, green when the last answer came back, red when the server could not be reached. A failure also removes the "Thinking..." row instead of leaving it under the error, which read as still working.
- The prompt enhancer is now in the pane, beside Send: it rewrites the draft in place, becomes "Undo" so the person's own words go back, and shows up to three pills naming details the message was missing. Typing by hand clears the undo. The rewrite is served by the app's own enhancer, so the words match the window and the web chat.
- One page serves Excel, Word and PowerPoint, so the enhancer and the indicators are one code path with no branching on the host. A self-test fails if that changes, and a second one pins the thinking row and the four connection states.
- Checked in a browser against the real pane files, with a stand-in Office and server: Excel, Word and PowerPoint each improved a draft, showed "Undo" and three pills; the busy state read "Improving..." with the button disabled; a failure showed the red dot with no leftover thinking row; a fresh pane showed amber "Connecting to Office..."; a normal answer went dark then green and cleared the waiting row. 0 console errors on the normal pane.
- The pane now wears the same clothes as the app and the phone build. It had its own small scale: 8-10px corners and a 1px hairline around every button and card, so a panel docked in Word or PowerPoint looked like a different product. Buttons you press are pills (999px) with no outline, the composer is the app's 28px box, the proposed-change card and the open-prompt rows are rounded fills (20 and 14), and the header rule is gone. The numbers come from the app's own scale rather than new ones.
- On a narrow pane the "Edits" label is hidden from the eye but kept for a screen reader, which frees the width the app name needed. Touch screens get 44px controls; a mouse keeps the denser height so a docked pane stays short. The spreadsheet preview keeps its cell lines, since that is data rather than a card.
- Sending a message clears the enhancer: the button returns to "Improve", the suggestions go, and pressing it cannot restore a draft that has already been sent.
- A self-test now pins the pane's shape (pill controls with no outline, the 28px composer, 44px touch targets, and the cell grid that must stay), so it cannot drift back.
- Bumped to 0.2.16.
- Key files: src/addin/taskpane.js, src/addin/taskpane.html, src/addin/taskpane.css, src/main/addin.js, src/main/main.js, scripts/selftest.js.
- Other OS action: none beyond the usual. The pane ships inside the desktop app, so Word, Excel and PowerPoint pick the change up from the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (composer menus read down one gutter)

- Every row in the composer pop-ups is a HeroUI Button, and the button base centres what it holds. A row only looked left-aligned when its label happened to stretch to fill the row, so the same menu showed four rows centred (Add files or photos, Add folder, Slash commands) and three starting at its left edge. The rows now set their own horizontal alignment, and the base's 2px side-shave on a glyph is neutralised inside the menu, so icon-led labels and iconless rows sit on one column.
- A row with no glyph keeps an empty 1rem slot of the same width, in both apps, so the labels line up even where there is nothing to draw.
- Measured, not eyeballed: the desktop + menu (7 rows) puts every icon at 334.7 and every label at 362.7, its reply-length sub-list puts all three labels at 217.3, and its model and mode menus are single-column (782.7 and 840.7). The web + menu at 390 wide puts every icon or empty slot at 42 and every label at 68, its sub-lists included.
- Why it kept coming back: the correction was in the source but never shipped. The installed desktop copy carried the older rule without the alignment, and the phone bundle in the repository predated the empty-slot rule, so the phone put "Start incognito chat" and "Export chat" a glyph's width left of the rest.
- A self-test assertion now pins the rule in both stylesheets and the slots in both menu components, so an edit that drops them fails the suite instead of shipping.
- Bumped to 0.2.14.
- Key files: src/renderer-react/app.css, src/renderer-react/ChatPanel.jsx, web/src/styles.css, web/src/views/ChatView.jsx, scripts/selftest.js.
- Other OS action: npm run web:build, then npm run cloud:deploy. The Android needs npm run android:build; the desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (a menu that scrolls says so)

- Both apps hide every scrollbar on purpose, which is right for a page and wrong for a floating menu: the model picker ends in a row cut through the middle at the foot of its height cap, and nothing on its face said there was more below it. The composer pop-ups (the model list, the + menu and the desktop mode picker) and the web project menu now draw a thin 8px rounded bar in the muted tone, only while their rows actually overflow. Everywhere else the no-scrollbar design is unchanged.
- The bar is restored in both spellings. Chromium swaps to its own thin bar, arrows and all, as soon as `scrollbar-width` names a thickness and then ignores the rounded thumb, so the rule leaves it at `auto` and draws the thumb itself; Firefox has no `::-webkit-scrollbar`, so a `@supports not selector(::-webkit-scrollbar)` block names a thin bar with the same colour for it alone.
- The web model list and the web + menu had no height cap at all, so on a short screen they grew past the top of the window and their first row sat where nothing could reach it. Both are capped to `min(60dvh, 22rem)`, the same share of the window the desktop menu uses, and scroll inside the cap.
- Checked in a browser at 390 wide: the model menu at a 430px window showed the bar with all of it on screen; the + menu at a 300px window showed the bar and stopped 72px above the bottom edge, where before it hung off the top; at a taller window the + menu fit, so no bar appeared. The desktop pop-up was driven through the built renderer stylesheet in a browser. The chat thread, the chat list and the page itself still draw no bar and claim no width.
- Bumped to 0.2.13.
- Key files: web/src/styles.css, src/renderer-react/app.css.
- Other OS action: npm run web:build, then npm run cloud:deploy. The desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (every UI measures from one rail)

- The signed-in panel was two slightly different panels: the chat column carried 14px of side padding and every other page 16px, so the whole navigation jumped 2px sideways whenever Chat opened. One 16px rail now, at every width.
- Text down the sidebar sat on five different left edges (brand name, nav labels, RECENTS, chat titles, footer note). Two columns now: 26 for icons and rows without one, 52 for labels that follow an icon, held at 390 and 1280.
- A project tile took the width of its own name, so a row shared neither a left nor a right edge and left a dead strip beside it. Tiles fill their grid cell on phone and desktop.
- The five Settings tabs were each as wide as their word inside a 210px column. They take the column's width, so all five start and end on the same edges.
- A phone chat reserved 64px at the bottom for the tab bar that no longer exists, so the composer floated above the edge. The composer sits 16px from the sides with 20px below it.
- The two floating chat icons (menu, new chat) were pinned to the whole thread area, so on a wide screen they sat hundreds of pixels outside the column the messages and composer use. They take the transcript's own width and padding, and the phone menu icon is one flat 44px control on every page.
- The public top bar sized itself from the 1440px shell while every public section is 1200px with its own side padding, so at 1280 the logo sat 32px left of the headline. The bar takes the sections' container and their padding at each width.
- The desktop model picker squashed its rows into its capped height, so each explanation drew over the next model name. A row keeps its own height and the list scrolls instead, capped at 70% of the window with a 4px gap, so it stays inside a short screen.
- The desktop account row was 4px tighter and less round than every other row in the panel. It takes the 12px inset and the pill corner, so its avatar sits on the icon column.
- Bumped to 0.2.12.
- Checked: npm run test passes every stage (both builds, selftest, server tests, Electron smoke, first run, both demos, chat sync), none failing. The web pages were measured in a browser at 390, 1280 and 1920: every card, form and list starts on the line of its page heading, and no grid cell keeps a shrunken child.
- Key files: web/src/styles.css, web/src/views/SettingsView.jsx, src/renderer-react/app.css.
- Other OS action: npm run web:build, then npm run cloud:deploy. The desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (desktop matches the web, navy logo, no console errors)

- The web text fields no longer pass isDisabled and isReadOnly to the page as unknown attributes, which logged two console errors. They go on as the native disabled and readonly attributes. The date, time and select fields carry an aria-label.
- The doubled focus ring on date and time fields is gone on the web and the desktop.
- The Plans grid shows four plans in one row from 1200px, two from 700px, one below.
- On a phone the web bottom bar is gone: chat is the first screen and a floating menu button opens the sidebar as a drawer. The dark-mode switch lives in Settings only.
- The logo plate is navy (#1e3a8a) on the web, the desktop and the docs. scripts/recolor-logo.py reads the plate colour it is given.
- Bumped to 0.2.11.
- Other OS action: npm run web:build, then npm run cloud:deploy. The desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (the theme is one switch, in every UI that asks the question)

- Light and dark are one on-or-off question, so each place that asks it now draws one switch. The desktop Settings General and Appearance rows show the mode name beside the track instead of two radio circles, which on a narrow window stacked into a column of dots. The desktop account menu's theme row was a plain row that flipped the scheme on every press, so it read as somewhere to go rather than as a setting; it holds a switch now and the row itself no longer reacts to the pointer. The web keeps the same control in the public top bar and in the sidebar brand row, with a sun or moon icon naming the mode it is in.
- The switch was invisible in light mode. HeroUI paints the off track from --switch-control-bg, which this palette sets to almost the page colour, so both positions looked like an empty pill. Both themes now name the four state colours: a muted track that turns brand blue when on, and a white thumb that shows against either. Held at the far side when on, whatever the thumb's own colour rule says.
- On a phone the icon-and-switch group takes the full 44px tap height and the bar keeps its 65px, with no sideways scroll at 390px. The web bar at 1920px is unchanged.
- Two more hand-built controls moved onto the shared HeroUI wrappers. The overview's allowance was an empty div with a width, so a screen reader was told nothing; it is the same HeroUI progress bar as the usage page, drawn 6px slim and without that page's top margin. "Add a file" on a project was a file-upload label dressed as a button; it is a HeroUI Button that opens the picker through a ref, and the transparent stretched input is gone.
- An abandoned hand-rolled switch (markup and six CSS rules that nothing rendered) is deleted from src/renderer-react/app.css, so its colours can no longer drift from the real control.
- Checked: the desktop account menu, Settings General and Settings Appearance were driven in a browser against the built renderer with the bridge stubbed, at 1280 and 390 wide, in light and dark; the web switch in both bars at 390, 1280 and 1920, in light and dark. npm run test passes every stage (both builds, 46 selftest assertions, server tests, Electron smoke, first run, both demos, chat sync), including two new checks that fail if a light/dark radio pair, a theme icon button, or a hand-drawn progress bar comes back.
- Still open: the desktop sign-in tab strip stays native, because HeroUI's Button drops the tab role there; the hidden file inputs stay native, since HeroUI has no file input; the two picture viewers stay as they are, being full-screen layouts rather than dialogs.
- Key files: src/renderer-react/SettingsView.jsx, src/renderer-react/Sidebar.jsx, src/renderer-react/app.css, web/src/components/TopBar.jsx, web/src/views/Dashboard.jsx, web/src/components/ui.jsx, web/src/views/OverviewView.jsx, web/src/views/ProjectsView.jsx, web/src/styles.css, scripts/selftest.js.
- Other OS action: npm run web:build, then npm run cloud:deploy. The desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (the account screens open bright, and the age question is one of them)

- The installed app's sign-in, create-account and age screens no longer take their colours from the saved theme. Each one carries data-theme="light" on its own page, which re-declares the light tokens for that subtree only: the screens are bright on every machine, whatever theme was last chosen, and the shell keeps its own theme underneath. The store still defaults to dark for the app, so before this the first screen of a fresh install was the navy canvas.
- All three screens now share one layout (src/renderer-react/AuthLayout.jsx): the photograph panel with the brand mark, the eyebrow, the headline and the three glass trust chips, then the card and the four footer links. One copy instead of three, so the registration page and the age question cannot drift away from the sign-in screen again.
- The card takes the web's numbers: 420px wide, 28px radius, 22px/20px padding, 14px gap, a 14px two-way switch whose active half lifts to --selected, a 20px heading and a 13.5px lead. The page is minmax(0, 1fr) minmax(380px, 30%), so 1280 and 1920 both fill the window with no dead strip, and below 900px the photograph steps aside and the card takes the width.
- The fields lost their hairline and lift to the white surface instead, which is how the web tells one surface from another. Buttons on these screens take the web's 14px radius instead of the shell's pill, the page sets color-scheme light so native controls match, and a disabled primary fades its own navy to 45% rather than turning grey.
- The age question is the same card as sign-in: "How old are you?", two full-width rows, Continue, and a way out to another account. Under 18 keeps the app closed and shows the refusal card in the same shell; changing the answer brings the question back. The rows are native radios inside a fieldset, so the answer is announced and the arrow keys work. HeroUI's Radio was tried first and renders here without a role or an input, so the choice never registered and Continue stayed disabled; the existing check that guards the Radios in Settings is untouched.
- Checked: npm run test passes, every stage (build, 44 selftest assertions, server tests, Electron smoke, first run, both demos, chat sync), none failing. The desktop renderer was driven in a headless browser with the bridge stubbed and a dark saved theme: the page paints white with a 28px card, the password field computes white with a 0px border, selecting Under 18 enables Continue and opens the refusal card, choosing 18 or older enters the shell with no page error, and 390px has no sideways scroll while the photograph panel is hidden.
- Key files: src/renderer-react/AuthLayout.jsx, SignInView.jsx, SignUpView.jsx, AgeGateView.jsx, src/renderer-react/app.css.
- Other OS action: none for the browser, no web file changed. The desktop needs the rebuilt installer to carry the new screens.
- Done on: Windows

## 2026-11-04 - Windows (an empty composer is one line, and New chat stops looking selected)

- The composer was 59px before anything was typed. The auto-grow measured the field and then added its own padding, but scrollHeight already includes that padding, so every box was 18px taller than its text: an empty box looked like two lines and a short sentence looked padded. Measured as it is, one line of text is one line of box (41px), and the field still grows with the typing.
- The New chat row sat permanently filled soft blue among unfilled rows, so it read as the current chat. It is unfilled like its neighbours and only tints on hover or keyboard focus.
- The notification rows had 3px between the title, the message and the date; they are 6px apart now, since the row has the height to spare.
- Checked: npm run test passes, every stage, 196 checks, none failing, including a new check that fails if a composer counts its padding twice or if New chat is filled again. The empty composer measures 41px in a browser (22.5px line plus 18px padding), and every textarea on the chat, automations, reminders, tasks and projects screens reports resize none.
- Still open: two reports I could not reproduce and so did not change blind. The allowance gauge and its track share an exact top and height (317.9px, 6px) and the seven weekly bars share one baseline, so I could not see the misalignment being described. The project row measures 44px with its label centred 12px from each edge, which is the 44px tap target; narrowing it needs a number from the person rather than a guess.
- Key files: web/src/views/ChatView.jsx, web/src/views/OverviewView.jsx, src/renderer-react/app.css, web/src/styles.css, web/src/components/ui.jsx, src/renderer-react/ui.jsx, src/renderer-react/SettingsView.jsx, src/renderer-react/ChatPanel.jsx, scripts/selftest.js.
- Other OS action: npm run web:build, then npm run cloud:deploy. The desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (Settings draws again, and only the shapes that were wrong changed)

- The Settings page blanked the whole window. HeroUI's Radio reads its selected value and its disabled state from the RadioGroup above it; the theme and age pickers drew bare Radios, so mounting threw "Cannot read properties of null (reading 'isDisabled')". Both pickers are inside a real RadioGroup again, and a check now fails if any file draws a Radio without one.
- The shape of a drop-down was a lozenge. The select trigger had taken the same 9999px pill as a button; it now takes the field radius, so it is the rounded rectangle a field should be. Nothing else was reshaped: the send and stop buttons keep their 36px circle, the suggestion chips keep their pill, and the radios, switches and tick boxes are untouched.
- The Settings search was a box inside a box. The HeroUI field inside the pill drew its own fill, corners and shadow; it is see-through now and the pill draws the box, with the focus ring moved to the pill.
- A suggested addition was a bare text row. It is the soft-filled pill now, on both surfaces, so it reads as something you can tap.
- Left alignment: the account menu rows and the Settings rail were centred, because HeroUI centres whatever a button holds. Both start at the left edge again.
- The message box grows with the typing. HeroUI's base sheet sets `textarea { resize: vertical }`, which put a drag handle in every multi-line field and a scrollbar down the composer; the composer now grows with the message and no textarea shows a handle.
- Checked: npm run test passes, every stage, none failing. The desktop renderer was driven in a headless browser with the bridge stubbed: all nine Settings sections render with no page error, the menu and rail report flex-start, the send button computes 9999px on a 40px square, the select trigger computes 10px, and both halves of the prompt enhancer work (the draft is rewritten and three pill additions are drawn).
- Key files: src/renderer-react/SettingsView.jsx, src/renderer-react/ChatPanel.jsx, src/renderer-react/Sidebar.jsx, src/renderer-react/app.css, web/src/styles.css, web/src/views/ChatView.jsx, scripts/selftest.js.
- Other OS action: npm run web:build, then npm run cloud:deploy. The desktop needs the rebuilt installer.
- Done on: Windows

## 2026-11-04 - Windows (the enhancer does both jobs, and the selection is a pill)

- The prompt enhancer is meant to do two things at once: word the typed message better in the composer, and list the details the message left open. The server always returned both, and both apps always wrote the rewrite back. What made it look broken was the local preview server, whose mock echoed the prompt back unchanged, so the composer showed the same words it started with. The mock now rewrites honestly and keeps only the suggestions the message is actually missing.
- Two new checks hold the pair together. One fails if either surface stops putting the rewrite in the box or stops drawing the additions. The other drives `readEnhancerReply` directly: it reads the rewrite and the list apart, ignores a chatty opening line, and refuses a reply that is really an answer.
- The nav items and the saved-chat rows take a fully rounded pill with symmetric padding. The highlight used to be a rounded box whose fill sat nearer the lower edge, so a two-line row read as though its words were sliding off the bottom of the selection.
- The desktop sidebar rows now match the browser: the name, a quote of the last message, and how long ago the chat was touched. The row is content-sized off its own class rather than `:has()`, so the rule cannot quietly stop applying if the markup is nested differently.
- Checked: npm run test passes, 309 checks, none failing. Looked at in a browser at 390, 1280 and 1920 wide, and the deployed bundle was read back to confirm the pill rule, the Recents heading and the single search field all reached Railway.
- Key files: web/src/styles.css, src/renderer-react/app.css, src/renderer-react/Sidebar.jsx, scripts/preview-web.mjs, scripts/selftest.js.
- Other OS action: npm run web:build, then npm run cloud:deploy for the browser and phone. The desktop needs a rebuilt installer to carry the sidebar row.
- Done on: Windows

## 2026-11-04 - Windows (a saved chat shows its name again, and chat history has a door)

- In the browser, and on a phone through the same build, every saved chat in the sidebar showed only a time. The HeroUI migration had put each row's whole label inside HeroUI's Button, which is a fixed 40px box that centres what it holds; the row stacks a name, the last message and a time, so the name was squeezed to nothing while the timestamp, which does not clip, survived. The row is content-sized again with a 44px tap target, the name on one clipped line above the message and the time beside it. The desktop sidebar never lost its names and is unchanged.
- Each row now carries the words of the last message: the conversations summary in server/src/db.js returns a bounded preview of the newest message, so a chat can be recognised without opening it.
- The chat search was two boxes: the pill drawn by `.conversation-search` and a second HeroUI field inside it with its own corners, padding and shadow. The input now draws nothing and the pill is the only box, and the focus ring moved to the pill so the field still shows focus.
- The saved-chat column has a heading again, Recents on the chat and Chats inside a project, with a Chat history button at its end.
- New web screen at /history lists every chat including archived ones, with search, restore, delete one and delete all. Closing it refreshes the chat list without remounting the open chat.
- Checked: npm run test passes, 303 checks, none failing, and the three new selftest checks fail if the row is put back inside a fixed height, if the inner search field draws its own box, or if the heading and the way into the history are removed. Looked at in a browser at 390, 1280 and 1920 wide.
- Key files: web/src/views/ChatView.jsx, web/src/components/ConversationSearch.jsx, web/src/views/HistoryView.jsx, web/src/views/Dashboard.jsx, web/src/App.jsx, web/src/lib/api.js, web/src/styles.css, server/src/db.js, scripts/selftest.js.
- Other OS action: npm run web:build, then npm run cloud:deploy so Railway serves the new bundle. The desktop app needs no rebuild for this.
- Done on: Windows


## 2026-11-04 - Windows (HeroUI is the only component library on desktop, web and mobile)

- Flowbite React is gone. Both surfaces now render HeroUI v3 (`@heroui/react` + `@heroui/styles`), and the shared `ui.jsx` of each surface is the only way a page reaches a control: Button, IconButton, Input, Textarea, Select, Checkbox, Radio, Chip, Card, UsageBar and Alert are all HeroUI underneath. `flowbite-react` is removed from the dependencies and from both stylesheets.
- The product palette is mapped onto HeroUI's own CSS variables (`--accent`, `--default`, `--field-*`, `--focus`, `--separator`, radius), so HeroUI controls wear the navy/soft-blue theme in light and dark instead of HeroUI's default violet. Component tweaks live in the `components` layer of each stylesheet: 9999px pills, 12px fields.
- Every hand-written control was converted: no `<button>`, `<select>` or `<textarea>` remains in `web/src` or `src/renderer-react`, and the only native inputs left are the hidden `type="file"` pickers. Mobile is unaffected in behaviour because Capacitor bundles the same web build (`dist-android`) into the Android project.
- Android: `dist-android` and `android/app/src/main/assets/public` were rebuilt and synced, so the APK ships the HeroUI bundle.
- The desktop sidebar check in the selftest asserted a Flowbite-era rule (`.zuri-button > span`) that no longer exists; it now asserts the HeroUI button can still shrink and the thread title still clips. The web chat check now requires zero raw buttons instead of tolerating three.
- Checked: `npm run selftest` and `npm test` pass, both bundles build, the desktop window shows no console errors, and a DOM audit of the rendered pages found every control carrying HeroUI classes.
- Key files: web/src/components/ui.jsx, src/renderer-react/ui.jsx, src/renderer-react/SelectField.jsx, web/src/styles.css, src/renderer-react/app.css, scripts/selftest.js, package.json.
- Other OS action: run `npm install` (new dependencies `@heroui/react` and `@heroui/styles`, `flowbite-react` removed), then `npm test`.
- Done on: Windows

## 2026-10-30 - Windows (selftest chat checks no longer race their temporary stores)

- The wordless-turn selftest could fail with CHAT_NOT_FOUND because the preceding text-call check was still using the process-wide temporary store when the next check switched it. The checks now wait at that boundary before changing roots.
- Checked: `node scripts/selftest.js` and `npm test` both pass.
- Key files: scripts/selftest.js.
- Other OS action: run `npm test` before using the selftest suite.
- Done on: Windows

## 2026-10-30 - Windows (explicit memories are shared across cloud chats)

- Zuri Cloud now stores short, user-managed memories that can be added and deleted from the Account page. Memories are scoped to the signed-in account, capped at 100 entries of 500 characters each, and never exposed across accounts.
- Cloud chat includes those memories as bounded context while clearly labelling them as context rather than instructions.
- Checked: `npm test` passes, including the new authenticated memory route and prompt-context regression checks.
- Key files: server/db/schema.sql, server/src/db.js, server/src/app.js, server/test/memories.test.js, web/src/lib/api.js, web/src/views/AccountView.jsx, web/src/views/Dashboard.jsx.
- Other OS action: run `npm test`, then run `npm run cloud:deploy` before using memories in the browser or Android build.
- Done on: Windows

## 2026-10-29 - Windows (a created task says so in colour, and an Office edit actually lands)

- The Office pane applied a plan once per streamed word when edits were set to Always allow, because the change card is rebuilt on every repaint and each rebuild applied it again. That is why the same refusal appeared twice in a row, and it could apply one plan to a workbook more than once. A plan now runs at most once, and the Apply button is spent once an automatic apply has started.
- One wrong operation also threw away the whole plan and reported it as one sentence that named no operation, which is why an Excel edit could fail with nothing reaching the sheet and no way to see why. Plans are now carried out one operation at a time, each in its own batch, so a refusal is named beside the line of the plan it belongs to and the operations that do work still land.
- A chart or a table asked for over an empty range is refused with a plain reason before it is sent, because Excel answers that with an argument error that names no cause.
- Column widths are now set on the range itself rather than through getEntireColumn(), which is one fewer host call that can fail on its own.
- A created to-do, reminder or automation used to be only a sentence. It now draws a green confirmation card under the reply (a pill, the name and what was set up), described once in src/shared/notableActions.js so the desktop window and the browser chat word it the same way.
- src/shared had to join the installer's file list in package.json. Without that the packaged window would have opened without the file it imports, which is a start-up crash rather than a missing card.
- When the second attempt at a wordless reply failed for a reason of its own (no credit, a network fault), that reason was discarded and the person was told the model had said nothing. The real failure is now what they see.
- Checked: the full suite passes, 243 checks, none failing, including three new ones for the card (all three kinds describe a card, nothing paints an empty one, and both apps read the one shared description with src/shared packaged). The card's light and dark appearance was checked in a browser against the built stylesheet. Not checked by machine: the Office apply needs a real Excel window, which this machine cannot drive.
- Key files: src/addin/taskpane.js, src/shared/notableActions.js, src/main/providers/chat.js, src/renderer-react/ChatPanel.jsx, src/renderer-react/app.css, web/src/views/ChatView.jsx, web/src/styles.css, package.json, scripts/selftest.js.
- Other OS action: npm run cloud:deploy for the browser bundle; npm run dist and reinstall for the desktop.
- Done on: Windows
## 2026-10-29 - Windows (Zuri searches on its own, and asks one question when the ask is vague)

- The browser and the phone had a search tool and no instruction to use it, so they answered from memory and hedged about being unable to browse. Both prompts now say to decide for themselves when to search, name the cases that need it (jobs, prices, news, travel, availability), forbid telling the person to look it up themselves, and forbid claiming a search that did not happen.
- The same block says to ask exactly one short question when the ask is too vague to search well, with a default offered so a one-word answer is enough, then act.
- The tools list is now validated before the prompt is assembled, because whether any tools are offered decides what the prompt says about searching. The validation used to sit after that point, which would have read an undeclared value.
- Verified against the live server. Asking find me a job returned a clarifying question naming role and place, with defaults, and no tool call. Asking any project manager jobs in Scotland this week returned two webSearch calls on its own. Running the full loop (search, feed results back, answer) produced four self-chosen searches including a refined one, survived a search that returned nothing, and ended in a real answer naming s1jobs, totaljobs and LinkedIn with links and an honest note that only index pages were visible.
- Also verified in a browser on the live site, signed in: the Tasks page loads and says Zuri can add tasks from a chat, adding one by hand wrote it and the list showed it, ticking it moved it to done, and the Reminders page loads with its form. Both are reachable from the dashboard navigation.
- Checked: full suite passes, 240 checks, none failing. Three new checks assert the search sentence and the one-question rule exist in both the server prompt and the desktop prompt, so the two apps cannot drift apart.
- Key files: server/src/text.js, server/src/app.js, src/main/providers/chat.js, scripts/check-chat-sync.mjs.
- Other OS action: npm run cloud:deploy is required for the browser and phone behaviour; the desktop needs no deploy.
- Done on: Windows

## 2026-10-29 - Windows (tasks and reminders work in the browser and on a phone, and a picture can actually be attached)

- The browser chat offered only the search tool, so a to-do or a reminder asked for there came back as words. Both are now offered, backed by new server routes, and the web app gained Tasks and Reminders pages so the rows are visible and editable outside the desktop app. This is what makes the same account work across the app, the website and Android, which bundles the web build.
- The reason an uploaded picture showed a file name and then got no answer was two faults stacked. The upload went to Cloudinary, which was never configured on the deployment, so every attach failed and the composer only ever showed a name. And the line sent to the model said the file contents were not readable, so the model answered vaguely. The server now stores the picture itself in a stored_files table and serves it back scoped to its owner, with the first bytes sniffed so a mislabelled type cannot be served as a script, and the composer shows a thumbnail of what was attached.
- An image cannot send a bearer token, so the serve route also accepts the session token as a query parameter and nowhere else. That is written down where the route is, because it is the one place this app does it.
- The Office pane gained the standing answer it was missing: an Edits control with Ask each time and Always allow, plus a Always allow button on each change card. Before this the pane always asked and never remembered, so a person editing a document had to press Apply for every change and had no way to say the answer once. The choice is stored per browser, not per account, since it is a preference about that machine.
- Checked: the full suite passes, 237 checks, none failing. That includes the new server route tests for tasks and reminders (isolation between accounts, a task-less title refused, a priority outside the three refused, a reminder needing a real moment), the stored-file tests (a real PNG stored and served byte for byte, a GIF declared as a PNG refused, an HTML type refused, a file another account owns answering 404), and four new checks that the browser chat still offers all three tools.
- Key files: server/db/schema.sql, server/src/db.js, server/src/app.js, server/test/tasks.test.js, server/test/uploads.test.js, web/src/views/TasksView.jsx, web/src/views/RemindersView.jsx, web/src/views/ChatView.jsx, web/src/lib/api.js, web/src/App.jsx, src/addin/taskpane.html, src/addin/taskpane.js, src/addin/taskpane.css, scripts/check-chat-sync.mjs.
- Other OS action: run npm install only if new deps appear (there are none), then npm run test, then npm run cloud:deploy so the new routes exist. The browser and Android cannot create a task until the server is deployed.
- Done on: Windows

## 2026-10-29 - Windows (Zuri can search the web and keep a to-do from the browser chat too)

- Reported from a screenshot of the browser chat: asked to add a to-do, Zuri answered that it had no file-writing tool and that Zuri keeps no to-do list inside the app. Both halves were true as built, and neither should have been. The desktop has had web search and file tools for weeks; the browser chat sent no tools at all.
- The real gap was three separate things. The browser chat offered the model no tools, so it could only describe what it would do. There was no way for a browser to run a web search, because a page cannot call a search engine directly. And Zuri had no tool for its own Tasks page in either app, only a store function the app called from its own screens.
- New route POST /api/tools/web-search: signed in, paid plan, its own rate limit keyed per account so a search cannot spend a chat model allowance, query trimmed to 2-400 characters, fixed engine address inside server/src/tools.js so no caller-supplied URL ever reaches fetch. The engine status and its markup stay in the server log; the person gets a sentence they can act on.
- server/src/tools.js holds the search and the result parsing, ported from the desktop tool of the same name: html entities are decoded before parsing, only http and https results survive, at most 8 results, title 200 / snippet 400 / url 500 characters, a 15 second timeout and a 2 MB body cap.
- The browser chat now runs the same shape of tool loop the desktop does: it offers exactly one tool, webSearch, runs the call against the new route, sends the results back and loops at most 3 rounds, with one final round that offers no tools so the person still gets written words. Picture models get no tools. Stop aborts the whole loop rather than one round, and only the question and the final answer are saved.
- While a search runs the bubble says so: Searching the web for "project manager jobs in Scotland", then Reading the results. Before this the window was blank through the wait.
- Both apps gained a createTask tool. It sits in BASE_TOOLS, so it is offered in every mode including Ask: writing down a to-do the person asked for is reversible from the Tasks page, and asking permission to write a to-do would be silly. Read-only unattended automations are untouched because they run from an allow-list of read-only tool names.
- Two more tools closed the rest of the gap. createReminder lets Zuri set a reminder, which is how it puts something in front of the person later: the reminder the app already shows as a notification. It rides with the tools offered on every message, because a reminder the person asked for is a row on the Reminders page they can edit or delete. A reminder with no moment is refused by the store and that reason goes back to the model so it asks for one instead of guessing.
- createAutomation lets Zuri schedule a prompt to run by itself, from a one-off moment, an interval or a daily time, rebuilt from a flattened cadenceType into the nested shape the store validates. It is gated: withheld in Ask, offered in Act and Autopilot, and it always asks before saving, because an automation outlives the conversation. Unattended automations still cannot create automations, because that name is not on the read-only allow-list.
- Streaming was nearly lost in the same change: answering a tool round whole made every browser reply arrive in one dump again, the exact thing the streaming fix had removed. Tool rounds now stream like any other reply, with the calls riding in the done frame, which both the desktop and the browser already read. The words still type out while a search is offered.
- A supplier can also write a tool request as text when it is given no tools. That markup is now read on the server, turned into a real call where it can be, and held back as it arrives so it is never painted, not even for one frame. The closing round of the browser loop keeps the tools offered and asks for words instead, because taking them away is what made the model write markup in the first place.
- A second real fault was caught by testing the live round trip rather than the code path: a reasoning supplier (DeepSeek Flash) refuses the round that carries tool results unless the thinking that produced the calls is echoed back. DeepSeek answered exactly that: the reasoning_content in the thinking mode must be passed back. The desktop already kept it; the server did not. The server now returns it with the tool calls, accepts it back on the assistant turn (bounded to 20000 characters, never stored, never shown) and the browser echoes it. The round trip test asserts both directions and fails if the echo is removed.
- A double wrap found while testing: searchWeb already answers { query, results } and the route wrapped it again, so results arrived nested inside themselves. Caught by the new route test before it shipped.
- Checked: server/test/tools.test.js covers no token, lapsed plan, empty and whitespace queries, a query over the cap, a real parse of DuckDuckGo markup with a decoded ampersand, the fixed endpoint being the one called, and a 500 or a network failure answering 502. The full suite passes, all 8 stages. Against the live engine, searchWeb returned 8 real results for "project manager jobs in Scotland" (LinkedIn, Totaljobs, Indeed, Glassdoor). The desktop createTask tool is covered in scripts/selftest.js, including a title-less call being refused and adding nothing.
- Version raised to 0.2.5, Android versionCode 6.
- Key files: server/src/tools.js, server/src/app.js, server/test/tools.test.js, server/package.json, web/src/lib/api.js, web/src/views/ChatView.jsx, src/main/tools/index.js, src/main/providers/chat.js, scripts/selftest.js.
- Other OS action: run "npm run test && npm run cloud:deploy", then rebuild with "npm run dist", "npm run android:build" and the macOS workflow. The browser search needs the server deploy; without it the new route answers 404. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (a silent turn is retried, the answer streams as it is written, a step says what it does, and a picture can be pasted)

- Reported from a screenshot: four questions, no replies, and "a message needs non-empty content" where an answer should have been. That sentence is the local store refusing to save an empty message, so the person was reading an internal refusal. The cause is the same one behind the printed `<tool_call>` block: a model sometimes writes its tool request into the reply text for a tool that turn never offered. The markup is stripped as markup, which leaves nothing, and a turn with no words then ends as an error.
- A turn with no words in it now gets one more round with no tools offered and a plain instruction to answer in words. That round is what the person reads. If even that comes back silent the message is "Zuri did not write an answer that time. Send the message again.", and nothing empty is saved to the chat. A reply that arrives whole rather than as deltas is painted in that round too; before this it was saved and the window stayed blank.
- The reason a reply looked dumped rather than typed: the Node adapter read the whole response body into memory before writing anything. Measured on the live server, all 44 pieces of one answer arrived in the same millisecond, so the window sat blank for the whole wait and then everything appeared at once. It now writes each chunk as it arrives, pauses on backpressure, and cancels the read when the client goes away so Stop ends the request at the source. The same measurement after deploy shows 203ms and 996ms of spread between first and last piece.
- Each tool step now says what it is doing before it starts, in words a person would use: "Searching the web for project manager jobs in Scotland", "Reading notes.txt", "Writing report.docx", "Opening Notepad". A search used to run in silence and only report afterwards, which reads as a broken window.
- The composer takes a picture straight from the clipboard with Ctrl+V. The bytes are written into the workspace under `pasted/` and the message attaches it by path, which is the same shape a picked file has, so nothing downstream changed. The content decides rather than the name: a PNG, JPEG, GIF or WebP must carry its own signature or the paste is refused, the name keeps only its extension, and a payload over 25 MB is refused. Only a paste that really carries an image is intercepted, so text pastes are untouched.
- Version raised to 0.2.4, Android versionCode 5, so the new installers cannot be confused with 0.2.3, which does not carry the step or paste work. Windows, macOS and Android builds are published together at v0.2.4; publishing first attached the older 0.2.3 files to the new release, which would have offered a download labelled with the wrong version, so they were removed and only the 0.2.4 files remain.
- Checked: two new suite checks (a wordless turn recovers; every step has a plain sentence) and 13 checks on the pasted-image guard, with the wordless fix disabled on purpose to confirm its check fails without it. The full suite passes, 233 checks, none failing. Against the deployed server, the fallback's request shape (nudge in the system instruction, no tools) returns a real answer, and a request with no tools came back as plain prose rather than markup.
- Still open: the browser chat offers no tools at all, so it was not possible to reproduce a printed tool block there; the model declined in words instead. The web has no markup stripping, so if a model ever does write a tool block in a browser chat it would show raw. Not changed without a reproduction.
- Key files: server/src/serve.js, src/main/providers/chat.js, src/main/main.js, src/main/preload.js, src/renderer-react/ChatPanel.jsx, scripts/selftest.js, package.json, android/app/build.gradle.
- Other OS action: run "npm run test && npm run cloud:deploy" (the streaming change only helps once Railway runs it), then rebuild the installers with "npm run dist", "npm run android:build" and the macOS workflow. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (the sign-in panel shows a team, and leads with the agent)

- The dark panel beside the sign-in form was a drawn scene of a Lagos lagoon at dusk with a network of points over it. It said nothing about what Zuri is for. It is now a photograph of three colleagues in a Lagos office working something out together on one laptop, so the picture carries the teamwork idea and the copy is free to make the claim.
- The panel now names the product before it makes a claim: a small "Your AI agent" label sits above the headline, matching the "Your AI workspace" label the landing page already uses.
- The copy leads on the agent and on range rather than on billing. Sign in reads "Welcome back to your agent."; create account reads "One agent for work, and for everything else." with a line about the report, the trip, the invoice and the appointment, which is the productivity and everyday-life framing rather than a plan or a dashboard.
- The photograph is pale behind the copy, so the cover is a fall-off rather than a tint: near opaque where the text sits, clearing to nothing at the right edge, so the people come out of the dark. Its stops are in pixels, not percentages, because the text is a fixed measure while the panel is not. A percentage scrim held at 1280 but left the paragraph sitting on a white shirt at 900, where the same text fills two thirds of a much narrower panel. The paragraph is also narrowed to 34ch so it stops short of the laptop screen.
- Checked at 390, 900 and 1280 wide: the panel is hidden on a phone as before with no sideways scroll, the team is clear and the copy legible at both desktop widths, and the sign in, create account and reset password screens all keep the same panel. No console errors and no request for the removed drawing.
- The drawing is gone (web/public/img/auth-aside.svg and its copy in server/public/img), so the preview server gained JPEG and WebP types: a picture sent as a generic binary stream is not drawn at all.
- Photograph: Ninthgrid on Pexels, free to use without attribution.
- The card the person actually fills in had kept the old framing on the same screen: "Your plan, usage and chats are waiting" and "One account for the desktop app and this dashboard". Those are now "Pick up where your agent left off" and "One account for your agent, on desktop and in the browser", so the whole screen speaks about the agent rather than about plans and dashboards.

- Key files: web/src/styles.css, web/src/components/AuthShell.jsx, web/src/views/AuthView.jsx, web/public/img/auth-team.jpg, scripts/preview-web.mjs.
- Other OS action: run "npm run test && npm run web:build". Railway must redeploy to serve the rebuilt web bundle. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (a chat started in the browser now arrives in the desktop app)

- Chat history was going up to the account but never coming back down as a new chat. Every sync ran from the list of chats already on the machine: it pushed those up and pulled new turns into them. A conversation started in the browser has no local chat to pull into, so no run could ever reach it, and it stayed invisible on the desktop for ever. Only the reverse case worked, which is why a desktop chat showed up on the web.
- The sweep now ends by asking the account what it holds, and takes on every conversation this machine has never seen: it opens a thread with the browser's title, links it to the conversation, and pulls its turns in. A linked chat is skipped next time, so nothing is adopted twice, and taking a chat on uploads nothing back.
- A chat opened in the browser and never typed into opens no thread here, because an empty row in Recents would say nothing.
- Deleting a chat and clearing the list were both the other way round: they empty this machine and leave the account's copy behind, which the new sweep would then hand straight back. The id of a deleted chat is now written down before the best-effort delete goes out, so it is never adopted again, and clearing the list sends the account the ids first for the same reason.
- The turns brought in are counted in the same figure the window already watches, so Recents and the open chat refresh on their own; nothing new had to be wired for that.
- Key files: src/main/chat-sync.js, src/main/main.js, scripts/check-chat-sync.mjs, scripts/selftest.js.
- Other OS action: run "npm run test". No new dependency and no database change. The installed app needs a rebuilt installer to carry it.
- Done on: Windows

## 2026-10-29 - Windows (the footer holds the bottom of every page)

- The footer sat directly under the content, so on a page with little on it (a Projects list with nothing in it yet) it floated halfway up the window with a pool of empty colour underneath. The signed-in pages now fill the height the window has left and the footer's own auto margin carries it to the bottom edge; a long page still scrolls, with the footer at the end of it.
- The card is a column that grows and is never allowed to shrink (`flex: 1 0 auto`). A column allowed to shrink would squeeze the cards on a long page instead of letting the page scroll. Side by side at 1280 the Overview page measures the same height with the column as without it, so nothing is compressed.
- The account screens (sign in, sign up, forgot password, reset password) had the same fault. The card and its one note now sit inside a growing column, so the footer holds the bottom of the panel: centred under the card on a wide window, at the top of the panel on a phone, and below the form when the form is taller than the window.
- The chat is deliberately unchanged: it has no footer and keeps its own full-height layout.
- Checked at 390, 1280 and 1920 wide: all six signed-in pages keep the footer at the bottom of the window with no sideways scroll, the Overview page keeps its natural height, and the chat still fills the window with no footer.
- Key files: web/src/styles.css, web/src/components/AuthShell.jsx.
- Other OS action: run "npm run test && npm run web:build". Railway must redeploy to serve the rebuilt web bundle. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (a tool call written into the reply runs instead of being printed)

- Asked "search the web for job opportunities for project manager in Scotland", the desktop app answered with `<tool_call>{"name": "webSearch", ...}</tool_call>` in the bubble. Zuri Flash had written its tool request into the reply text and left the structured calls field empty, and the signed-in route read only that field, so the request was printed as the answer and no search ran.
- The reader that already handled DeepSeek's DSML markup now reads both spellings, and it runs on the account route, which is the one the shipped app uses. A call naming a tool that round offers is run, its result goes back to the model, and the model then writes the real answer. A call naming anything else is dropped rather than run.
- The markup is held back while the reply streams, so it is never painted and then taken away: only text before a tool block is shown, and a trailing "<" waits until the next chunk proves it is ordinary text. Nothing of the markup reaches the screen or the saved chat.
- A call read out of the text is given an id (`call_text_0`), because the tool result has to quote the same id the assistant turn used and the text carries none.
- Key files: src/main/providers/chat.js, scripts/selftest.js (two checks: the reader, and a whole round driven through the real send code).
- Other OS action: run "npm run test". No new dependency and no database change. The installed app needs a rebuilt installer to carry it.
- Done on: Windows

## 2026-10-29 - Windows (the Naira picture prices line up, a Lagos dusk behind the form, pictures in the model picker)

- The "Pictures, priced in Naira" cards sat in one narrow column with a wide empty strip beside them. Two different rules in the web stylesheet were both named `.image-grid`: the landing page's three price cards and the saved-picture library. The library rule came later and won, so the price cards were laid out as a shelf of small library tiles. The library is now `.image-library-grid`, and the three price cards take the full width of the page as three equal columns.
- The sign-in and sign-up panel was a flat grey column beside the form. It now shows a drawn scene: a lagoon at dusk with a bridge, a low city skyline with lit windows and masts, a sun on the water, and a glowing network of connected points in the sky, finished with an ankara-inspired geometric border. The words on the panel are light in both themes because the scene is dark at every size. It is vector art, so it stays sharp at any window size and costs about 12 KB.
- The model picker beside Send now closes with a Pictures group holding Zuri Sketch, Zuri Canvas and Zuri Studio, read from the server's own model catalogue. A model the plan does not include stays in the list, greyed, with the plan it needs, rather than vanishing. Choosing one turns the composer into a picture prompt ("Describe the picture to draw"); Send then goes to POST /api/images instead of the chat, the picture joins the thread with a line saying what drew it, and it is filed in the Images library on that device. A file waiting to be attached is refused with a plain sentence, because a picture request reads only words.
- Key files: web/src/styles.css, web/src/views/ChatView.jsx, web/src/views/ImagesView.jsx, web/public/img/auth-aside.svg, scripts/preview-web.mjs.
- Other OS action: run "npm run test && npm run web:build". Railway must redeploy to serve the rebuilt web bundle. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (Office add-in shows thinking while replies stream)

- The Office pane now paints a visible "Thinking..." card as soon as a request starts, instead of leaving an empty assistant row until the first token arrives. The existing streaming cursor remains active while reply text is being received.
- Key files: src/addin/taskpane.js, scripts/selftest.js.
- Other OS action: run "npm run test". No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (the other tabs are as simple as ChatGPT's)

- Every tab besides chat is now one centred column with a plain title, flat rows separated by a thin line, and one main action, instead of boxed cards inside cards. Desktop: Settings, Zuri Cloud, Features, Agents, Skills, Automations, Tasks, Reminders, Files, History and Search. Web: Overview, Usage and limits, Plans and Billing. Nothing was removed: every setting, number, button and message is still there.
- Agents and Skills now show a list first and open the editor or form only when you pick a row or press the new-item button. Tasks adds with one inline field.
- Key files: the matching src/renderer-react/*View.jsx files, web/src/views/{Overview,Usage,Plans,Billing}View.jsx, web/src/styles.css (a new section at the end).
- Other OS action: run "npm run test && npm run web:build". Railway must redeploy to serve the rebuilt web bundle. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (ChatGPT-style look, better replies, pictures that stay on your device)

- Web chat: the copy, edit, regenerate and share icons now sit in a row under each bubble instead of inside it, so the grey bubble can no longer hide the copy button. The coloured Zuri logo is back above the greeting on the web, Android and desktop start screens.
- Replies: the server now adds one shared set of answer rules to every web, Android and desktop chat (answer first, length that fits the question, one clarifying question, no invented facts, cite sources when web results are given) plus a short note for each supplier's known habits (DeepSeek, Kimi, GLM, OpenAI, Claude). The desktop keeps its own longer style block and only gets the supplier note. A project's own instructions still come first.
- Desktop sidebar: the thin icon strip is gone. One list now holds search, New chat, Projects with their chats nested, and Recents, with a Menu at the bottom for every other screen, Quick ask and the light or dark switch.
- Pictures: a new POST /api/images route draws one picture for a signed-in person whose plan includes the model. It reserves the model's share of the allowance, calls OpenAI or Z.ai, charges by the picture and refunds if the supplier fails. The description is rewritten for the chosen supplier by a small chat call (on by default, off with improve:false). The picture is returned once as base64 and the server keeps nothing.
- Local-only storage: the desktop saves each picture to the images folder in its workspace with its prompt, and a new Images screen (Menu) lists them with search, a large view, Save as, Copy, Delete and Make another. The web and Android app keep pictures in the browser's own storage (IndexedDB) and offer Download. The chat's + menu has Square, Portrait and Landscape and an Improve my description switch.
- Key files: server/src/images.js, server/src/app.js, server/src/text.js, server/src/server.js, server/test/images.test.js, server/test/text.test.js, src/main/main.js, src/main/preload.js, src/renderer-react/ImageLibraryView.jsx, src/renderer-react/Sidebar.jsx, src/renderer-react/ChatPanel.jsx, web/src/views/ImagesView.jsx, web/src/lib/imageStore.js, web/src/views/ChatView.jsx, web/src/styles.css, scripts/selftest.js.
- Other OS action: run "npm run test && npm run web:build". Railway must redeploy for the picture route, the new reply rules and the rebuilt web bundle, and OPENAI_API_KEY and ZAI_API_KEY must be set there for pictures to work. Rebuild the Android app with "npm run android:build" and the Windows installer. No new dependency and no database change.
- Done on: Windows

## 2026-10-29 - Windows (the Office pane knows which app it is in, and can draw a chart)

- The pane in Excel said "Word" and offered Word's suggestions. Office.js, the script that tells the pane which app it is inside, was being loaded from appsforoffice.officeapps.live.com, which does not resolve on this machine at all. With no script there was no host, and the pane had one line of fallback: assume Word. In Excel that meant it showed a Word screen, then ran Word's file-reading code against a workbook, which never answers, so the chip sat on "Reading the file..." for ever. The address is now the canonical appsforoffice.microsoft.com one, with the old address kept as a fallback.
- The host is no longer guessed at. The pane reads it from four places (onReady, Office.context.host, the _host_Info the desktop clients put in the pane URL, and the app namespace office.js installs) and waits up to fifteen seconds for one of them instead of picking Word after eight. If none of them answers it says so plainly, shows Try again, refuses to read the file and refuses to send a message, so a broken office.js can no longer look like a Word pane.
- A file read now has a twenty second deadline and is only attempted when the app's own namespace is loaded. A read that never settles says "Office did not answer in time" instead of leaving the chip reading the file.
- Excel can draw a chart: the new addChart operation takes a range, one of column, bar, line, pie, area or scatter, an optional title and an optional cell to sit at, and lands two columns right of the data when no cell is given. The model is told about it in the Excel contract, and it is offered as a suggestion on the pane's opening screen.
- Key files: src/addin/taskpane.html (office.js address and fallback), src/addin/taskpane.js (detectHost, readContext deadline, unnamed-host screen, chart applier), src/addin/ops.js (addChart), src/main/providers/chat.js (chart in the Excel contract), scripts/selftest.js (two checks, and the operation count is now 21).
- Other OS action: run "npm run test". No new dependency and no database change. Rebuild the installer and reinstall Zuri before looking for it in Office: the running app serves the pane from the installed folder.
- Done on: Windows

## 2026-10-28 - Windows (Zuri no longer denies the web search it has)

- Asked "can you browse the web?", the desktop app answered that it could not see live websites, even though web search was switched on and it had been handed the search and page-reading tools for that very message. The cause was one sentence in Zuri's own prompt: the date line ended "You still cannot see live websites or page contents unless a tool gives them to you", and that line was written the same way whether or not the tools were offered. The model read the rule, obeyed it, and never ran the search.
- The prompt now follows the tools. When web search is on for a message, Zuri is told it has webSearch and webFetch, to use them for anything current or after its training data, never to say it cannot look something up, and to say plainly when a search returns nothing useful instead of guessing. When web search is off, the old sentence stays, so a reply with no tools still claims no ability to browse. The same rule is applied to a scheduled run, which only claims the web when its own tool list contains the search.
- The flag that decides whether the tools are offered is the same flag that decides what the prompt says, so the two can never disagree again. This is a wording fix, not a new feature: search itself was already there, on by default in the composer's menu.
- Key files: src/main/providers/chat.js (chatSystemPrompt takes webTools, currentTimeContext writes one of two lines), scripts/selftest.js (one check proving both versions of the prompt).
- Other OS action: run "npm run test". No new dependency, no database change and no rebuild needed for the web bundle, which has no web search and says so.
- Done on: Windows

## 2026-10-28 - Windows (projects: file a chat into one, and prove the instructions travel)

- A chat can now be filed into a project from the web chat list. The row's actions menu gained "Move to project" (or "Move to another project" when it is already filed), which opens the project list inside the same menu rather than a dialog over the conversation: the current project is ticked, and "Take out of its project" returns the chat to the whole history. One press sends a single PATCH and the row records where it belongs, so the change survives a reload.
- Inside a project the list belongs to that project, so a chat moved somewhere else leaves the screen instead of sitting there as a chat the project no longer holds. The project list scrolls once it is taller than the window rather than running off the bottom.
- The rest of the project feature was already in place and is now covered by checks: the project screen holds the instructions, the reference files and the project's chats, with a New chat button that starts one inside it, and the server answers a chat in a project with that project's instructions and file text ahead of the question.
- One behaviour had no test: a chat that is not in a project. It is now checked that a chat filed nowhere carries none of a project's standing instructions or reference files, which is the case that would quietly leak one piece of work into another.
- docs/chatgpt-parity.md was out of date: it still reported pinning, archiving and date grouping as absent on both surfaces. The table now says what is true and where: pinning and archiving are web only, there is no archived screen to restore from yet, chats are grouped by period on the web, and projects carry instructions and files on the web while the desktop carries instructions only.
- Key files: web/src/views/ChatView.jsx, web/src/styles.css, server/test/projects.test.js, scripts/selftest.js, docs/chatgpt-parity.md.
- Other OS action: run "npm run test && npm run web:build". Railway must redeploy to serve the rebuilt web bundle. No new dependency and no database change; the projects tables already ship.
- Done on: Windows

## 2026-10-28 - Windows (the Office pane is a composer that can change the file)

- The Zuri pane in Word, Excel and PowerPoint was three boxes and one button. It read the selection, answered once, and the answer was copied into the file by hand. It is now a conversation with a composer at the bottom edge, the way the app's own chat works: the thread scrolls, a reply streams in as it is written, Stop ends it, and the chat comes back when the pane is reopened on the same file. A new chat button clears it.
- It can now do the work rather than describe it. Zuri answers with a short sentence and a change block: a JSON list of operations (set a range of values or formulas, set a number format, bold a header row, autofit, add a sheet, add a table; in Word replace or insert paragraphs with styles, apply a heading, find and replace, insert a table; in PowerPoint add a slide, retitle one, rewrite a shape, add a text box). The pane draws that block as a card: what will happen, a preview of the first cells, and an Apply button. Nothing reaches the file until Apply is pressed, and Ctrl+Z in Office undoes it.
- Every operation is checked before it can run. A range must be a real A1 reference written the right way round, a formula must start with "=", a grid must be rectangular, colours must be hex, sheet and table names must be legal, and the block must be valid JSON. A bad block shows why it was refused instead of applying half of it, and a block the model is still writing reads "preparing a change" rather than looking ready.
- What Zuri sees of the file is a map rather than a blob. In Excel: the workbook's sheet names, the used area, one line per row with the row number and the column letters, and every formula already in the area so a new one can match its neighbours. In Word: a numbered outline with each paragraph's style. In PowerPoint: each slide's shape names and text. The file travels with the newest question only, so older turns stay small and every answer is given against the file as it is now, which is what makes "now format that column" work after an apply.
- Instructions are built per app, so the Word pane never sees an Excel operation and the worked example matches the app it is in. The pane also refuses a plan written for another app instead of skipping it.
- Key files: src/addin/taskpane.html, src/addin/taskpane.js, src/addin/taskpane.css, src/addin/ops.js (new), src/main/addin.js (POST /api/chat streams as an event stream; /api/ask is gone), src/main/providers/chat.js (askForAddin replaced by chatForAddin), src/main/main.js, scripts/selftest.js (four checks), web/src/views/ChatView.jsx (one raw button became the shared Button).
- Other OS action: run "npm run test". No new dependency and no database change. Rebuild the installer (npm run dist) to ship the pane: the running app serves it from the installed folder, so reinstall and restart Zuri before looking for it in Office.
- Done on: Windows

## 2026-10-28 - Windows (attachments, pin and archive, one row menu)

- Attachments on the web chat now exist, and they cost Railway almost nothing. The account signs an upload (POST /api/me/conversations/uploads/sign), the browser posts the file straight to Cloudinary, and the message stores only a delivery URL. A 10MB photo therefore costs the API a few hundred bytes instead of being read into memory twice and paid for as egress. Three variables switch it on: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET. Without them every other feature keeps working and the composer says attachments are not available.
- What the server accepts is narrow on purpose. A delivery URL must be https, on res.cloudinary.com, and under this deployment's own cloud name, so a message can never be pointed at an address chosen to make the reader's browser fetch something. The type must be a picture or a PDF, the size at most 10MB, and the name is cleaned and capped. A refused attachment answers 400 INVALID_ATTACHMENT rather than being stored quietly.
- A picture is drawn at 240px in the thread, with its name under it; a PDF is a named row. A page thumbnail for a PDF was left out on purpose: every one is a paid transformation, and the row is enough to open it. A text file still travels inside the message, so it stays searchable and free.
- Chats can now be pinned to the top of the list and archived out of it. Both are flags on the conversation row, so the list stays one query: pinned first, then most recent, with the archive excluded unless ?archived=1 asks for it. Pinning a filed chat lifts it back out, since a chat that was both held and filed would appear in neither list. GET /api/me/conversations accepts the archived flag, and PATCH /api/me/conversations/<id> accepts pinned and archived beside title.
- Each chat row now has one actions menu (rename, pin to top, archive, delete) instead of four icons. The four squeezed the title down to a few characters, and a row is read far more often than it is acted on. Delete still takes two presses.
- Key files: server/src/uploads.js (new), server/src/app.js, server/src/db.js, server/db/schema.sql, server/src/config.js, server/src/server.js, server/test/conversations.test.js, web/src/lib/api.js, web/src/views/ChatView.jsx, web/src/styles.css, scripts/preview-web.mjs, docs/chatgpt-ui-deep-dive.md.
- Other OS action: run "npm run test && npm run react:build && npm run web:build". Railway must redeploy for the sign route and the two flags; the schema adds its three columns on the next server start (ADD COLUMN IF NOT EXISTS, so a second run is harmless). Set the three Cloudinary variables in Railway before attachments work there. No new dependency.
- Done on: Windows

## 2026-10-28 - Windows (one icon family, ChatGPT layout, no em dashes in replies)

- Every icon on every surface now comes from one family in src/renderer-react/Icons.jsx: a 24 unit grid, a 2 unit stroke, round caps, filled punctuation instead of hairlines, and a fixed size ladder of 16/18/20/24. Six glyphs are drawn in that file because the borrowed ones used a different metaphor (More, Settings, Spark, New chat, Panel, Stop). The web module re-exports the same family, and the four pages that imported the icon package directly now import it, so the browser and the desktop window cannot drift apart.
- The saved chat list groups under Today, Yesterday, Previous 7 days, Previous 30 days and Older, drawn from a data-group attribute on the first row of each stretch. Searching shows a flat list, because period headings would only push matches apart. The old Recents caption is gone, since the period headings replace it.
- Replies are held to a house style: no em dashes and no en dashes. Every conversation now carries the instruction, and the route rewrites the answer afterwards, including each streamed delta, so an older thread cannot bring the character back. Code is exempt, because a dash inside a string literal is the program own content. A number range keeps its shape (10-20).
- The rule is written twice on purpose: Railway uploads server/ on its own, so a shared module would never reach it. scripts/selftest.js now compares the server copy against the app copy over a shared corpus and fails if they ever answer differently, and also asserts that both sides apply the rule.
- Fixes on the way: three landing and overview pages still referenced icons by their old package names, which blanked the page at runtime. The web icon module no longer imports a second icon library, so one family is shipped.
- Key files: src/renderer-react/Icons.jsx, src/renderer-react/formatting.js (new), src/renderer-react/FormattedMessage.jsx, server/src/text.js (new), server/src/app.js, server/test/text.test.js (new), server/package.json, web/src/components/Icons.jsx, web/src/views/ChatView.jsx, web/src/views/Landing.jsx, web/src/views/OverviewView.jsx, web/src/components/ConversationSearch.jsx, web/src/styles.css, src/renderer-react/app.css, scripts/selftest.js, docs/chatgpt-ui-deep-dive.md (new).
- Other OS action: run "npm run react:build && npm run web:build". Railway must redeploy the server for the house style to be sent and applied. No database change and no new dependency.
- Done on: Windows

## 2026-10-28 - Windows (Office add-in packaging)

- Word showed "ADD-IN ERROR: this add-in could not be started" because the packaged app was missing the task pane files. The installer's file list only carried src/main and dist-react, so src/addin (taskpane.html, taskpane.js, taskpane.css) never reached the installed app, and the add-in server answered 500 for the page while /icon.png worked. package.json now packages src/addin/**/*.
- Key files: package.json.
- Other OS action: none; the Office add-in is Windows only. Rebuild the installer (npm run dist) and reinstall before the pane works.
- Done on: Windows

## 2026-10-28 - Windows (cleanup before release)

- The empty-chat screen now shows real counts and lists: open tasks, reminders and automations, the next tasks and the coming reminders, read from the same stores as those pages. The example cards (Writing sprint, 12 tasks this week and the calendar) are gone, along with the bar-chart styles in app.css.
- The bell opens Reminders and shows how many reminders are due now. It does not use the notification count because nothing ever marks a notification read, so that number would only grow. The "Zuri" title is plain text now; it had a dropdown arrow that did nothing.
- Skills can be edited (pencil on a skill). Editing changes the words and leaves the on/off switch alone.
- Removed the local-key reply route in sendChatMessage that could never run, since chat always goes through the account.
- New server route DELETE /api/me/conversations/<id>/messages/<messageId>, with tests. Regenerate now asks the account to delete the replaced reply; the desktop keeps remembering it (droppedCloudIds) until the account confirms, so an older server cannot bring it back.
- Key files: src/renderer-react/WorkspaceOverview.jsx (new), ChatPanel.jsx, Sidebar.jsx, SkillsView.jsx, app.css, src/main/providers/chat.js, store.js, chat-sync.js, server/src/app.js, server/src/db.js, server/test/conversations.test.js, scripts/selftest.js, scripts/check-chat-sync.mjs.
- Other OS action: run "npm run react:build". Railway must redeploy for the server route; until then Regenerate still works and the old reply stays in the browser copy only.
- Done on: Windows

## 2026-10-28 - Windows (act mode, skills, side panel)

- Ask, Act and Autopilot are real. A mode picker sits beside the model chip. Ask answers and reads, and no longer offers the edit tool, which could never run there. Act also offers editDocument, writeFile, openUrl and openApp, and asks the person first through an approval card above the composer; no answer, Stop or five minutes counts as no. Autopilot skips the question only for copy-only edits and allow-listed links and apps; writeFile always asks. The new channel is zuri:chat:approve.
- Bug fixed on the way: on the account route, a tool that built a file used a list that did not exist yet, so the reply failed with "cut off" and the file was never saved with the reply. The reply now carries its files.
- Side panel: code blocks have Open in panel, and files Zuri makes have Preview. The panel sits beside the chat on a wide window and over it on a narrow one.
- Skills: new Skills page (rail icon). Up to 20 saved, 5 on at once because each is added to every message. New channels zuri:skills:list, create, update, delete; skills.json is a new store file.
- Projects now carry instructions (edit icon on a project row), added to every chat filed under it.
- Regenerate button on the newest reply (hidden on picture replies). The account has no way to delete one message, so the browser copy of the chat keeps the old reply; the thread remembers the replaced reply's cloud id (droppedCloudIds) so sync never pulls it back into the desktop.
- The overlay hotkey is Ctrl+Alt+Space, registered for real (Win+Space is reserved by Windows). The tray hint says the same.
- Key files: src/main/providers/chat.js, store.js, main.js, preload.js, tray-menu.js, src/renderer-react/ChatPanel.jsx, ActControls.jsx, ResultPanel.jsx, SkillsView.jsx, NewProjectView.jsx, Sidebar.jsx, App.jsx, FormattedMessage.jsx, scripts/selftest.js.
- Other OS action: run "npm run react:build".
- Done on: Windows

## 2026-10-28 - Windows (projects)

- The desktop sidebar has a Projects section: create a project (name and icon) from the New project screen, open it to see its chats, move a chat in or out with the folder button on the chat row, and delete a project (its chats are kept and return to Recents). New chat now shows its Ctrl K shortcut, which works from any screen.
- Chats and projects stay separate files: a chat carries projectId, projects.json holds the folders.
- Key files: src/main/store.js, main.js, preload.js, src/renderer-react/Sidebar.jsx, NewProjectView.jsx, projectIcons.js, App.jsx, Icons.jsx, scripts/selftest.js.
- Other OS action: run "npm run react:build".
- Done on: Windows

## 2026-10-28 - Windows (admin dashboard)

- The web Admin screen now manages people and shows how the app is doing. Add a person (name, email, plan, days) and Zuri generates a temporary password, shown once, with an active plan and no payment step. Per account: change plan, reset password (signs them out everywhere), suspend and restore. Administrators cannot be suspended and you cannot suspend yourself.
- Health panel: people, seen today, requests and tokens today, paying plans and monthly revenue, payments paid and failed, requests per day, busiest people, database answer time and server uptime.
- New server routes: GET /api/admin/stats, GET and POST /api/admin/users, PATCH /api/admin/users/<id>. Covered by server/test/admin-users.test.js.
- Key files: server/src/app.js, auth.js, db.js, web/src/views/AdminPeople.jsx, AdminView.jsx, web/src/lib/api.js.
- Other OS action: Railway must redeploy to serve the new web bundle (server/public). The installers need no rebuild.
- Done on: Windows

## 2026-10-28 - Windows (sign-in first)

- The desktop app now opens on a Zuri sign-in screen when there is no session, and the Android app opens on sign-in instead of the marketing page. The cloud address is built in (the Railway API, or ZURI_CLOUD_URL for developers); the stored cloudUrl setting is gone.
- Settings is shorter: account and sign out, theme, model, standing instructions and the Office add-in. The four answer-style dropdowns and the server URL are removed; the Act allow-lists sit under a collapsed Advanced section.
- The add-in is one Office add-in for Word, PowerPoint and Excel. The install no longer runs PowerShell with -NonInteractive, which caused the "UI is not allowed in this operation" error.
- Key files: src/renderer-react/SignInView.jsx (replaces OnboardingView.jsx), App.jsx, SettingsView.jsx, src/main/main.js, src/main/addin.js, src/addin/taskpane.js, web/src/App.jsx.
- Other OS action: run "npm run react:build" (and "npm run android:build" for Android).
- Done on: Windows

## 2026-10-28 - Windows

- Added a Nigerian-inspired public home-page mockup with a Lagos editorial hero image, local work context, and links into the existing chat, tasks, and onboarding concepts.
- Refined the mockup toward a Flowbite-style system with white surfaces, navy structure, bronze accents, and less city-specific wording.
- Added a reference-inspired dashboard collage to the home hero with compact activity cards, project statistics, and a mini calendar.
- Applied the same dashboard composition to the real web landing page and changed the shared light web tokens to white, navy, and bronze.
- Key files: docs/mockups/index.html, docs/mockups/mockups.js, docs/mockups/assets/zuri-lagos-hero.png, web/src/styles.css.
- Other OS action: none required for the static mockup; run "npm run react:build" if rebuilding the renderer bundle.
- Done on: Windows

## 2026-10-25 - Windows

- Version 0.2.2 is published for all three platforms. The Windows setup and the Android APK were built here (release/Zuri-0.2.2-Setup.exe, and an APK reporting versionCode 3 and versionName 0.2.2); the macOS dmg came from the "Build macOS installer" workflow run on GitHub, because a dmg can only be produced on a Mac. The download page now offers 0.2.2 for Windows, macOS and Android. Before this it offered 0.1.0 on Windows, 0.2.1 on macOS, and no Android build at all.
- Both installers were rebuilt before publishing rather than renamed. The page reads the version from the file name, not the release tag, so publishing files built at 0.2.1 under a v0.2.2 tag would have offered a 0.2.2 download that still says 0.2.1.
- `npm run release:publish` could not create a release. It passed the title "Zuri Desktop 0.2.2" to `gh` through a shell, the shell split it at the space, and `gh` rejected the command. The script now calls `gh` with the arguments as a list, so the title arrives whole. An upload also reported 404 after succeeding, so check the release before retrying rather than trusting that error.
- Key files: package.json, package-lock.json, android/app/build.gradle, scripts/publish-release.mjs, README.md, release/** (installers, not tracked).
- Other OS action: none for the published files, they serve both. If you change the site, run "npm run test && npm run web:build". Rebuilding the Windows installer needs "npm run react:build" first.
- Done on: Windows
## 2026-10-25 - Windows

- Both installers were rebuilt at 0.2.1, because neither had caught up with the code. The Windows setup sitting in release/ was still 0.1.0, so it carried none of the cloud chat, the streamed replies, the five-hour window, the extra-usage packs or the browser chat work, and there was no Android APK on disk at all. Built: release/Zuri-0.2.1-Setup.exe and release/Zuri-0.2.1.apk, the APK reporting versionCode 2 and versionName 0.2.1, packaged from a bundle that contains the styles below.
- `npm run android:build` refused to run on this machine even though the Gradle wrapper is present in android/: "'gradlew.bat' is not recognized as an internal or external command". Windows only searches the current folder for an executable when that behaviour has not been switched off system-wide, and this machine has it switched off. The script now calls the wrapper by its full path, quoted so a project folder with a space in its name still works. Gradle fetches SDK platform 35 on the first run when it is missing, which only works because the SDK licence is already accepted.
- Secondary text was corrected. The transcript now draws on the canvas, and the muted colour measured 3.7:1 against it, below the 4.5:1 minimum for normal-size text. It is #5f6d83 now: 4.7:1 on the canvas, 5.25:1 on white. This supersedes the note in the entry below that accepted 3.7:1 on the model caption, which was below the minimum.
- The chat page drew a scrollbar down its own side at 390 and at 1280, because the page came out a fraction of a pixel taller than the window. The document no longer scrolls while the chat is on screen, so only the transcript scrolls and the composer stays at the bottom edge.
- Checked at 390x844 and at 1280x900, in dark and in light: nothing scrolls sideways, the page itself does not scroll, the composer sits at the bottom, and the prompt, reply, model caption, navigation and drawer all read clearly.
- Key files: web/src/styles.css, scripts/build-android.mjs, server/public/** (rebuilt), release/** (installers, not tracked).
- Other OS action: run "npm run test && npm run web:build", then "npm run android:build" for an APK. Rebuilding the Windows installer needs "npm run react:build" first, because electron-builder packages whichever renderer build dist-react holds.
- Done on: Windows

## 2026-10-25 - Windows

- Dark mode was checked on the chat for the first time and is correct: the transcript sits on the dark canvas, the reply bubble on a slightly lighter surface with a hairline, the composer and the navigation all keep their contrast, and nothing scrolls sideways. The prompt bubble in dark uses the light accent with dark text, which is the same pairing the desktop app uses.
- One colour corrected. The chat area had been painted white to give the reply bubble something to sit against, but the desktop paints it with its own background colour, which is the site's canvas. On white the reply bubble was clearer than in the app; on the canvas it reads the desktop does. The hairline stays, because the desktop's own bubble has no border and the two colours there are within a few points of each other.
- Measured contrast after the change: the reply text is 14:1, the model caption 3.7:1 (it was 1.95:1 against white), the prompt text 4.2:1. The caption figure matches the desktop, whose caption uses the same muted colour on the same background.
- The Android bundle was rebuilt after these styles, so the next APK carries the corrected colours and nothing from the old bottom bar.
- Key files: web/src/styles.css, server/public/** (rebuilt), dist-android/** and android/app/src/main/assets/public/** (rebuilt, not tracked).
- Other OS action: run "npm run test && npm run web:build", then "npm run android:build" for an APK.
- Done on: Windows

## 2026-10-25 - Windows

- Every icon control in the web chat is now the site's own Flowbite button: copy, back, new chat, send and stop, rename and delete. A new shared IconButton in the components file wraps Flowbite's Button, requires a label so an icon is never anonymous to a screen reader, and carries the site's 44px target, radius and colours. Before this the chat drew its own bare buttons with their own CSS.
- Icons all come from lucide, through the shared icon set or straight from the package, so the chat and the rest of the site draw the same family.
- Padding is fixed throughout the chat. Text was sitting against the edge of its container: a reply now has 14px above and below its text and 18px at the sides, the transcript has a 20px gutter and 24px under the last message, the composer has 16px before the field, and the conversation rows, the navigation and the opening screen all gained room.
- A reply had no visible container at all. The chat area was painted with a token that only exists in the desktop theme, so on the web it resolved to nothing and the area fell back to the page colour, which is nearly the same as the reply bubble. The area is white now and the bubble carries a hairline, so an answer reads as a card again.
- On a phone the chat's sidebar no longer wastes the top of the screen: the account card, the signed-in line and the download link are hidden there, because they belong to the wide panel and pushed the conversations below the fold.
- Two checks added: the chat is built from Flowbite controls with lucide icons and one copy path, and the drawer's floating button floats. Another existing check was updated for the copy control's new label.
- Key files: web/src/components/ui.jsx, web/src/views/ChatView.jsx, web/src/views/Dashboard.jsx, web/src/styles.css, scripts/selftest.js, server/public/** (rebuilt), dist-android/** and android/app/src/main/assets/public/** (rebuilt, not tracked).
- Other OS action: run "npm run test && npm run web:build", then "npm run android:build" for an APK carrying this.
- Done on: Windows

## 2026-10-25 - Windows

- The phone layout of the site and the Android app no longer has a bottom bar at all. Navigation is a floating round button in the top-left corner that reveals the sidebar, which is how the assistant apps do it. It sits under the top bar, over the page, and the page content starts below it so nothing is covered.
- A chat is now one sidebar, not three columns. The destinations, the account and the conversation list share a single column, so the chat itself gets the width the desktop app gives it: 896px, widening to 1024 and 1152 on larger screens. Before, the site showed a navigation sidebar, a chat list and the thread side by side and the answer column was squeezed.
- The chat's header bar is gone. Two bare icons float over the transcript instead, the way the desktop chat draws them: back to the chat list on a phone at the left, new chat at the right. The chat sits on the app background rather than a raised panel.
- The reply caption names the model above the bubble, outside it, and the copy control is the same small icon button the desktop transcript carries, on both the prompt and the reply.
- The opening line is at the desktop's scale: a 30px greeting and one 16px line.
- The Android bundle in the project was rebuilt, so the next APK carries this. The installed app still shows the old bottom bar until a new build is installed.
- Key files: web/src/views/ChatView.jsx, web/src/views/Dashboard.jsx, web/src/components/TopBar.jsx, web/src/App.jsx, web/src/styles.css, scripts/selftest.js, server/public/** (rebuilt), dist-android/** and android/app/src/main/assets/public/** (rebuilt, not tracked).
- Other OS action: run "npm run test && npm run web:build", and run "npm run android:build" to produce an APK with the new navigation.
- Done on: Windows

## 2026-10-25 - Windows

- The browser chat now mirrors the desktop one instead of approximating it. A reply is drawn by the desktop app's own markdown component, imported rather than copied, so code blocks, lists, tables and links read the same on both surfaces and there is only one set of rules to keep right. A prompt still shows exactly what was typed.
- Both a prompt and a reply carry the same copy action the transcript has in the app, as an icon that confirms with "Copied" and clears itself. Before this only the reply had one, because the web chat drew its own bubbles.
- The opening screen is the desktop's: the app mark, "Good morning, Ada" and one line about what can be asked, instead of a bare line of text. A chat also reopens on the model it was started with, read from the conversation rather than from whatever this tab last had picked, so a thread begun on Zuri Pro is not answered by Flash because someone changed the chip elsewhere.
- The chat page fills the window: the header sits under the top bar, only the transcript scrolls, and the composer stays at the bottom edge with the model chip and Send beside it, as in the app and in ChatGPT. Before, the page scrolled as a whole and the composer drifted down the page.
- The bottom tab bar is gone, at every width. Navigation is the sidebar on a wide screen, and below 900px a drawer opened by a menu button in the top bar, closed by its own close row, by the dimmed area behind it, or by choosing a destination. That is the shape ChatGPT uses and it stops the bar from covering the last row of a page or the chat composer.
- The chat is built from the same parts the rest of the site uses: Flowbite's Dropdown for the model menu, its Textarea for the composer, the site's Button and InlineAlert, and lucide icons. No new component library was added.
- Two refresh gaps closed. The web chat re-reads the account's list and the open thread when the tab comes back into view and once a minute while it is on screen, so a chat continued on a phone appears without a reload. The desktop app now announces a change when a sync pulls messages written in the browser, so Recents and the open thread update without a restart.
- Seven checks added to npm run selftest: replies go through the shared renderer, one copy path covers both roles, no bottom bar exists anywhere, the phone drawer has its menu button and scrim, the chat fills the window with only the transcript scrolling, the model beside Send is a menu that restores a chat's own model, and a pulled message announces the desktop refresh.
- Key files: web/src/views/ChatView.jsx, web/src/views/Dashboard.jsx, web/src/components/TopBar.jsx, web/src/components/Icons.jsx, web/src/App.jsx, web/src/styles.css, web/src/lib/format.js, src/main/main.js, scripts/selftest.js, server/public/** (rebuilt).
- Other OS action: run "npm run test && npm run web:build". No schema change, no migration and no new dependency.
- Done on: Windows

## 2026-10-25 - Windows

- The allowance now has a second clock. Besides the monthly tokens, every plan has a five-hour rolling allowance (Starter 250,000, Pro 750,000, Power 1,500,000, Max 5,000,000 quota tokens), measured from usage_events. Before calling a model, the server adds up the last five hours of committed usage plus any reservation still open, so a burst of parallel requests cannot spend the month in one afternoon.
- A refusal from that window answers 429 WINDOW_EXCEEDED with retry-after and the message names the reason, so a client can say when to try again instead of looking broken. The window is a pause, not a ban: it clears itself as older requests age out.
- Customers can buy extra usage without changing plan. Three one-off packs (1,000,000 tokens for NGN 1,500, 3,000,000 for NGN 4,200, 8,000,000 for NGN 10,000) are sold through Paystack and add to the period allowance for 90 days. The price and the token count both come from the server catalogue, never from the request.
- A top-up is a payment row with kind topup, a pack code and a token count, and no plan code, so the subscription is left alone and the billing history still reads in one list. The tokens live in a new usage_credits table as a ceiling rather than a wallet: nothing is decremented per request, which is what makes an expiry or a failed grant safe at any moment.
- Purchased tokens raise the five-hour ceiling as well as the monthly one, because otherwise a pack bought to get unstuck would still sit behind the window it was bought to get past. The ceiling stays finite because the tokens were paid for.
- The Usage page shows the window with the time it frees up, the purchased tokens, and the packs with a Buy button; Billing shows the extra balance and marks top-up rows in the history. The desktop Zuri Cloud page carries the same window bar and pack buttons, and opens Paystack in the browser through two new channels, zuri:cloud:topups and zuri:cloud:topup. Both checkout routes now share one opener, so the link is still only followed after it is confirmed to be Paystack own origin.
- Key files: server/src/limits.js, server/src/topups.js (new), server/src/usage.js, server/src/db.js, server/db/schema.sql, server/src/app.js, server/test/server.test.js, server/test/db.test.js, web/src/views/UsageView.jsx, web/src/views/BillingView.jsx, web/src/views/Dashboard.jsx, web/src/App.jsx, web/src/lib/api.js, src/main/main.js, src/main/preload.js, src/renderer-react/CloudView.jsx, server/public/** and dist-react/** (rebuilt).
- Other OS action: run "npm install && npm run test && npm run react:build && npm run web:build". No manual migration: the schema step adds the columns and the usage_credits table on the next server start, and ALTER TABLE ... ADD COLUMN IF NOT EXISTS makes a second run harmless.
- Done on: Windows

## 2026-10-25 - Windows

- A message that carries an attachment now stays on the device that opened it. The file's own wording is folded into the message text before it is stored, and so is the path it came from, so uploading the message put a private document into a chat history the browser can read. Those turns are marked localOnly and the sync skips them.
- The answer to such a turn is marked the same way, because a reply about a document quotes it straight back. Holding back only the question would have leaked the file through the answer.
- The rest of the conversation still syncs. A chat with an attachment in the middle keeps its ordinary turns in the account; only the file-carrying turn and its answer are held back, which is the point of the browser chat: continue the conversation, never ship the files.
- A chat made of nothing but attachments opens no conversation in the account at all, rather than spending one of the 200 slots on a title the browser could never fill in.
- The composer now says "Stays on this device" beside an attached file, so the behaviour is visible instead of a surprise when that chat does not show up in the browser.
- Key files: src/main/store.js (appendMessage marks the turn and the reply), src/main/chat-sync.js (isUploadable, and no conversation for an attachment-only thread), src/renderer-react/ChatPanel.jsx (runTurn localOnly), scripts/check-chat-sync.mjs (10 new checks).
- Other OS action: run "npm run test" after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Signed-in customers can now chat in the browser, on the same plan and token allowance as the desktop app. The site could sell a plan but had nowhere to use it: a person paid, then had to install the app before they could send a message. The Chat tab, at /chat, reuses the existing streamed chat endpoint, so pricing, quota and model choice are the ones already in the catalogue and nothing new is billed.
- Conversations are saved to the account, so a chat can be opened on another machine. Two tables, conversations and conversation_messages, hold them; both carry ON DELETE CASCADE so removing an account or a chat removes its messages instead of leaving them behind.
- Ownership is enforced by user_id in every query rather than by checking afterwards. Reading, renaming or deleting someone else chat answers 404, not 403, so a stranger cannot even confirm an id exists.
- Caps stop the history becoming a free storage service: 200 conversations per account, 500 messages each, 100000 characters per message.
- The desktop app mirrors its local chats to the account, so a thread started in the app can be continued in the browser. Push and pull are idempotent: a message carries the server id once uploaded, so a repeated sync skips it rather than duplicating. A cloud thread that was deleted is unlinked and recreated on the next sync instead of failing forever.
- Sync runs off the critical path. A reply is never delayed by an upload, a failure only writes one log line, and nothing is attempted when nobody is signed in or the machine is offline.
- The web chat is bounded on a phone. Without that the card grew with the conversation and the Send button ended up below the fold once a reply arrived.
- A new check, scripts/check-chat-sync.mjs, runs the desktop sync against a stand-in account with no server and no network. It proves the cases a live run would only reach by luck: a repeat sync adds no duplicates, a reply written in the browser reaches the desktop, and a chat deleted in the browser is forgotten rather than resurrected (it is re-created on the next reply, since restoring chats someone deliberately removed would be wrong). It runs under Electron because a real session can only be read with the app encryption, and it is part of npm run test.
- Version is now 0.2.0 so the installers carry this change.
- Key files: server/db/schema.sql, server/src/db.js, server/src/app.js, server/test/conversations.test.js, web/src/views/ChatView.jsx, web/src/lib/api.js, web/src/styles.css, web/src/views/Dashboard.jsx, src/main/chat-sync.js, src/main/store.js, src/main/main.js, scripts/preview-web.mjs, server/public/**.
- Other OS action: run "npm run test && npm run web:build". The two new tables are created by the schema step on the next server start, so no manual migration.
- Done on: Windows

## 2026-10-25 - Windows

- The admin dashboard can now be reached without touching SQL. Setting `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Railway creates that account, or promotes an account that already exists, on every start; the Admin tab in the dashboard then appears for that account and nobody else.
- The password is rewritten from the variable on each boot, so changing the variable is how it rotates. Leaving `ADMIN_PASSWORD` empty keeps the hash already stored, which is what an administrator who signs in with Google needs. The value is never logged and never sent to the browser: only the scrypt hash reaches the database.
- A new account also gets the Starter subscription sign-up hands out, because an account with no subscription cannot resolve a session, and the administrator would have signed in to an empty page.
- A failed setup is logged and the server keeps serving, the same way a failed schema step behaves, so a bad variable cannot stop a deploy.
- Key files: `server/src/config.js`, `server/src/auth.js`, `server/src/db.js`, `server/src/server.js`, `server/README.md`, `server/test/admin.test.js`.
- Other OS action: run `npm run test`. No schema change and nothing to rebuild; the server reads the variables on its next start.
- Done on: Windows

## 2026-10-25 - Windows

- Zuri Code is now Zuri Core. The row never did anything a coding feature would: it is an OpenAI general model priced exactly like Zuri Reason (2 dollars in, 10 out per million tokens, weight 10 and 30), so the name promised work the app cannot do while the model underneath answers general questions. Pricing, quota, plan gate and supplier are untouched, so no customer bill moves.
- The internal code stays zuri-code. Past usage records and saved settings files already name it, and rewriting the key would orphan that history without changing anything a person sees. A comment on the row records why the code and the name no longer match, and the schema migration moves only the seeded name, so a name an operator chose in the dashboard is never overwritten.
- The desktop picker also stopped naming gpt-5.3-codex, which OpenAI marks Deprecated. That row now asks for gpt-6.1-sol, the id the server catalogue has sold since the deprecation, and cloud-chat.js maps both ids to zuri-code so a settings file written before either change still answers.
- One gap the rename exposed: zuriModelName spells out an unknown Zuri code, so a settings file holding zuri-code would have shown "Zuri Code" and brought the retired name back through the chip. A RENAMED_CODES map now names it Zuri Core, and the selftest asserts that for both zuri-code and gpt-6.1-sol.
- The Pro plan card now reads "Zuri Core and Zuri Reason: prompts 10x, replies 30x", and server/public was rebuilt so the site matches the app.
- Key files: server/src/models.js, server/db/schema.sql, src/renderer-react/zuriModels.js, src/main/providers/cloud-chat.js, web/src/lib/format.js, scripts/preview-web.mjs, server/test/models.test.js, scripts/selftest.js, server/public/**.
- Other OS action: run "npm run test && npm run web:build" after syncing. The schema migrates itself on the next server start.
- Done on: Windows

## 2026-10-25 - Windows

- The chat model can now be chosen from the message row. A chip beside Send shows the model that will answer this chat (Zuri Flash, Pro, Max, Code, Reason or Elite) and opens the same six names with a one-line note each. It sits after the microphone, directly beside Send, and carries no icon: the name and a chevron are the whole control.
- The choice belongs to the chat, not the app. It rides with the next message, the reply stores the pair that wrote it, and reopening a chat restores its model from the newest reply. A chat with no choice of its own sends nothing, so the model in Settings stays in charge there instead of today's default being pinned into every future chat.
- `zuri:chat:send` accepts an optional `model: { provider, model }`. `providers/chat.js` checks the pair against the provider table before using it, because an id that does not belong to its provider is swapped for that provider's default by `resolveChatTarget`, which would make the chip name a model that never answered. An unknown pair is ignored rather than failing the reply, so a chip left from an older catalogue never blocks a chat.
- The six names moved into `src/renderer-react/zuriModels.js`, because Settings and the composer both offer them and two copies of a supplier id would drift apart. The chip never shows a supplier id: an older settings file holds `gpt-4o`, which the cloud answers as Zuri Flash, and a Zuri code the catalogue has not caught up with is shown as a name (`zuri-ultra` becomes Zuri Ultra).
- The quick-ask popup is a 420px card and keeps the chip out of its row, so that window still follows the model in Settings.
- Three checks added: every catalogue row answers with the id it names, a picked model is the one the account is asked for and the one recorded on the reply (with a mismatched pair ignored), and the chip stays in the right-hand group with no robot icon.
- Replies now name the model that wrote them, read from the model stored on the reply rather than from the chip. A caption read from the chip would relabel old answers the moment someone changed model.
- The caption appears once per model change, not on every bubble: the first reply carries it, and so does the first reply after a switch, which reads as the point where the conversation moved. A chat that never left one model would otherwise repeat the same name down the whole transcript while the chip already names it.
- Replies saved before a model was recorded carry none and show no caption, so an older chats.json opens exactly as it did.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/zuriModels.js`, `src/renderer-react/SettingsView.jsx`, `src/main/providers/chat.js`, `src/main/store.js`, `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing. No schema or settings change; `chats.json` simply gains a `model` field on new replies and old ones read fine without it.
- Done on: Windows

## 2026-10-25 - Windows

- Replies now carry their own quota weight, which closes the last way the catalogue could lose money. A supplier bills the reply at four to eight times the prompt's rate, but the monthly allowance counted both at one weight, so Zuri Code, Zuri Reason and Zuri Elite sold the expensive half of a request at the cheap half's price.
- The mechanics: at the old single weight those three began costing more than the plan fee once 62.5% of the allowance had gone on replies, and nothing in the code or the tests could see it. Zuri Flash, Pro and Max never crossed it on any plan; the three dear ones did, and all three at the same point.
- `models.quota_weight` still prices the prompt and a new `output_quota_weight` prices the reply. 0 means "same as the prompt", so every row seeded before this behaves exactly as it did and no existing bill changes. The admin dashboard shows and edits both, and the site's plan bullets now name both numbers.
- Every text model's reply weight is at least three times its supplier output price, which keeps about half the plan fee as margin even for an account that spends its entire allowance on replies. The worst case is now 47% margin on Pro and Max and 57% on Power, where it used to be a loss. The models test fails if a catalogue figure ever breaks the rule.
- A live database picks the new weights up on the next server start, only where the weight is still 0, so an operator's own figure is never overwritten.
- Key files: `server/src/models.js`, `server/db/schema.sql`, `server/src/db.js`, `server/test/models.test.js`, `web/src/lib/format.js`, `web/src/views/AdminView.jsx`, `scripts/preview-web.mjs`.
- Other OS action: run `npm run test && npm run web:build` after syncing. The schema upgrades itself; there is no manual migration.
- Done on: Windows

## 2026-10-25 - Windows

- All six supplier model ids are confirmed against each supplier's own documentation (October 2026), and one was wrong. The OpenAI id behind Zuri Code exists but is marked Deprecated: it answers today and will stop, and a withdrawn id fails every request the day it is switched off. Zuri Code now uses that supplier's current balanced model at $2/$10 per million tokens, with its reply weight at 30 (three times the output price, like the rest of the catalogue). Their coding flagship bills $10/$50, which the Pro allowance cannot carry without a weight that cuts the monthly allowance by more than half.
- Confirmed correct and now pinned by the models test: `deepseek-flash`, `claude-sonnet-5-5`, `claude-opus-5-5`, `kimi-k3` and `glm-5.3`. The image models still name `gpt-image-2`, which its supplier lists without a deprecation, so they are unchanged.
- Migration added for databases already seeded: it moves `zuri-code` to the new id and price only when the row still names the old one, so a choice an operator made by hand is never overwritten.
- Prices stand as checked against each supplier's published rates: DeepSeek $0.14/$0.28, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20. The models test pins them and names the page each figure came from.
- Correction, recorded so it is not repeated: an earlier pass read Opus 5.5 as $5/$25 and changed Zuri Elite to that figure with a reply weight of 75. That was wrong. The supplier lists $4 input and $20 output per million tokens, so the catalogue was correct from the start. Those figures are restored with a reply weight of 60, and the migration from that pass was removed because against the real rows it would have written a wrong price over a correct one. The numbers above are the final ones.
- Key files: `server/src/models.js`, `server/db/schema.sql`, `server/test/models.test.js`.
- Other OS action: run `npm run test` after syncing, then deploy so the schema migration updates any live database.
- Done on: Windows

## 2026-10-25 - Windows

- Act mode now works over the Zuri account. The app offers tool definitions, the server forwards them to the supplier and returns the calls the model asks for, and the app runs those tools on the person's own computer before asking again. The tools never run on the server: it only carries the request, so a workspace file is still read where it actually lives.
- Wire format: a tool result is a message with `role: "tool"` and the `toolCallId` it answers; an assistant turn repeats the `toolCalls` it made. Each supplier client arranges those into its own shape (OpenAI-style `tool_calls`, Anthropic `tool_use`/`tool_result` blocks), and the Anthropic client collects a round's results into one user turn as that API requires.
- A request that offers tools is answered whole rather than streamed: the point of that round is the call, not the words. The round is still charged, because its tokens were spent, so a loop cannot be made free by calling tools. Plain chat keeps the streaming path.
- The loop is bounded by the existing `MAX_TOOL_ROUNDS`, and an agent's allow-list still narrows what the model may call, so a model cannot name a tool that was never offered.
- Validation added: tools must have a name and at most 20 may be offered; an assistant turn may call at most 8 tools; a tool result must carry the id of the call it answers. A crafted body is refused before anything reaches a supplier.
- Not covered: the cloud route forwards no `tools` for image generation and does not carry the Write/`dsml` markup the direct route tolerates, so a supplier that cannot emit real tool calls will simply answer in text instead of acting. Automations and the Word add-in still use the direct-provider path.
- Key files: `server/src/deepseek.js`, `server/src/app.js`, `server/test/server.test.js`, `src/main/providers/cloud-chat.js`, `src/main/providers/chat.js`, `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Added `docs/voice-options.md`, a research note on voice: what the microphone button does today (browser dictation only, no model, no spoken reply), which of the five suppliers can actually do voice (OpenAI yes; DeepSeek, Kimi and Anthropic no; Z.ai unverified; Google, ElevenLabs and Deepgram would be new suppliers), and the three lanes with list prices converted at the 1,600 naira default rate. Short version: better dictation costs about 8 to 12 naira a minute, spoken answers about 64 naira a minute, and a realtime conversation about 48 naira a minute on Gemini Live or 300 to 500 on OpenAI Realtime.
- Decision recorded in the same file: voice stays as browser dictation for now, and nothing in the app changed. The note lists what must be verified before a voice model is priced into the catalogue, including that a minute of audio is not a fixed number of tokens and that Zuri bills by tokens today, not by seconds.
- Key files: `docs/voice-options.md` only. No source or config change, so no build is needed.
- Other OS action: none, read the note after syncing if voice comes up.
- Done on: Windows
## 2026-10-25 - Windows

- The composer's "Search the web" toggle now works on the Zuri account route. The cloud route has no tool loop, so the search cannot be a call the model makes; instead the app runs its existing `webSearch` tool before sending, shows "Searching the web..." while it runs, and passes the numbered results as a second system message after the identity. The model is told to cite results as [n], to end with a `Sources` line of markdown links for the results it actually used, and never to invent a source. A search that finds nothing is reported to the model as such rather than filled in from memory, and a failed search does not fail the message.
- The results are instruction for that one request only and are never stored with the chat, so a later reply cannot cite a page nobody searched for.
- Correction to the previous entry: file and folder attachments already reached the account route, because the composer inlines the file text into the message before it is sent. Nothing needed changing, and a check now pins it so the assumption cannot drift back.
- Superseded by a later entry above: Act mode is now covered, because that tool loop was built. The reasoning is kept because it explains why the loop had to be written rather than routed around. At the time of this entry Act tools ran only on the person's own computer, and the model could not ask for one through the cloud route.
- Key files: `src/main/providers/cloud-chat.js` (webSearchContext, lastQuestion, cloudMessages), `src/main/providers/chat.js`, `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows
## 2026-10-25 - Windows

- Signed-in replies now arrive word by word. `/api/chat` takes `stream: true` and answers server-sent events (`delta` frames, then one `done` or one `error`); the suppliers are asked to stream too, so the text the person sees is the supplier's, not a re-chunked whole. Both supplier clients share one SSE reader, and an Anthropic stream is normalised to the same result shape as the OpenAI-compatible ones.
- The charge is unchanged by streaming. The plan is still reserved before anything is sent, committed after the reply finishes from the usage the supplier reported, and released if the reply never landed. A streamed reply commits exactly what a non-streamed one would: this is asserted in the server tests.
- A refusal still arrives as JSON before any text does, so an over-quota account is told plainly instead of watching half a reply that will never be billed. A supplier failure mid-reply sends one error frame, releases the reservation and charges nothing.
- The window reads frames in `providers/sse.js`, which is its own module so the parser can be tested without a network: a frame split across two network chunks, a truncated reply and an error after text all have checks. An older deploy that answers plain JSON still works, just without the typing effect.
- Stop now ends a streamed reply cleanly. Aborting the request under the stream surfaces as a failed read, which is mapped to the same "stopped" wording the direct route uses rather than being reported as a network fault.
- Known gaps, unchanged: web search, Act mode, file creation and image attachments are not sent on the account route yet, so the composer's web-search toggle does nothing for signed-in chat. Automations and the Word add-in still use the direct-provider path.
- Key files: `server/src/app.js`, `server/src/deepseek.js`, `server/test/server.test.js`, `src/main/main.js`, `src/main/providers/sse.js`, `src/main/providers/cloud-chat.js`, `src/main/providers/chat.js`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows
## 2026-10-25 - Windows

- Chat now goes through the person's Zuri account, so no provider key is needed to use the app. `providers/cloud-chat.js` builds the request and names the Zuri model; `main.js` posts it to `/api/chat` with the saved session; `providers/chat.js` takes that route whenever the window asks for a reply. A settings file that still holds a supplier id (deepseek-flash and friends) is translated to the Zuri code rather than discarded. A signed-out window is told "Sign in to Zuri to get replies" instead of being asked for a key.
- `cloudFetch` now takes a `timeoutMs` and an abort signal, because a chat reply can take far longer than the 20 seconds every other call allowed, and Stop has to be able to end one still being written.
- Settings no longer presents the key as the way to chat: the model line says it is billed to the Zuri plan, and the key card is relabelled "(optional)" because the Word add-in still answers through a provider directly.
- Known gaps on the account route, none of them silent: replies arrive in one piece rather than word by word, and web search, Act mode, file creation and image attachments are not sent. Automations and the Word add-in still use the direct-provider path, so they still want a key. Moving streaming and the tools onto the server is the next piece of work.
- Key files: `src/main/providers/cloud-chat.js`, `src/main/providers/chat.js`, `src/main/main.js`, `src/renderer-react/SettingsView.jsx`, `src/renderer-react/OnboardingView.jsx`, `src/renderer-react/GoogleSignInButton.jsx`, `src/renderer-react/CloudView.jsx`, `src/main/onboarding.js`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows
## 2026-10-25 - Windows

- The quick-ask popup still showed sharp, straight edges even with its shadow drawn in CSS: Electron's own window shadow (`hasShadow: true`) paints a rectangle behind a transparent frameless window, so it drew square corners outside the round card. That shadow is now off, and the card's soft shadow is the only one left.
- The transparent border the card sits in grew from 24px to 40px, and the card shadow is now an 8px offset with a 28px blur that reaches 36px, so it finishes fading inside that border instead of being sliced off at the window edge.
- The popup could not be moved at all. A frameless transparent window has no title bar, and Chromium's app-region drag does not move one on Windows, so the card's top strip now reports how far the pointer travelled and the main process moves the window by that much, over a new `zuri:overlay:move-by` channel. In a live run, dragging the header moved the window from 300,200 to 555,277. The card is clamped to the work area of the display it is on, so a long drag cannot lose it under the taskbar or off the edge of the screen, and the "Open Zuri" and "Close" buttons still click because a press on them never starts a drag.
- The self-test now fails if the popup loses its header drag, its `movable` window option, its native-shadow-off flag, or the `zuri:overlay:move-by` channel through the bridge and main, on top of the existing check that keeps the window margin, the card padding and the shadow size in agreement.
- Key files: `src/main/overlay.js`, `src/renderer-react/app.css`, `src/renderer-react/ChatPanel.jsx`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run selftest` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- The admin dashboard now shows what each picture model costs, what it sells for and the margin per picture, and the edit form carries the picture fields (billed as, USD per picture, allowance tokens per picture, size label). A picture is priced on the plan that sells it first: quoting every image model at the Starter rate made a Pro-only or Max-only model look cheaper than it is. With the current catalogue the margins are NGN 41, 152 and 416 a picture.
- `/api/chat` now refuses a picture model with the code `IMAGE_MODEL`. Before, its supplier name went to the text endpoint, which cannot draw, and no charge was recorded because nothing was generated.
- The local preview server carries the picture models and `/api/image-prices`, so the dashboard rows and the marketing picture section can be reviewed offline.
- Server tests cover both: a picture model is refused in chat, and the dashboard figures are asserted per plan.
- Key files: `server/src/app.js`, `web/src/views/AdminView.jsx`, `server/test/models.test.js`, `scripts/preview-web.mjs`.
- Other OS action: run `npm run server:test && npm run web:build` after syncing.
- Note: no picture is generated or billed yet. There is no image endpoint, so this change finishes the prices and margin only.
- Done on: Windows

## 2026-10-25 - Windows

- First run no longer asks for a provider API key. Step two is now a Zuri account: Continue with Google, or an email and password, reusing the same CloudAuthForm the Cloud page uses. The key form moved to Settings, where a person who would rather pay a provider directly can still add one. Signing in stays optional, so "Skip for now" still writes the name and theme and opens the app.
- A key is no longer required to finish setup: the onboarding channel stores one only when it is given, and answers hasKey false otherwise. The old code called setKey with an empty string, which setKey refuses.
- The Google button is now one component (GoogleSignInButton) shared by first run and the Cloud page, so the client id, the callback shape and the failure wording cannot drift apart. It also loads the script on demand, so an offline launch shows the password form instead of an empty box.
- Note: a signed-in account still does not answer chats by itself. Chat sends every request straight to a provider with a local key, and never calls the cloud /api/chat route, so a person who signs in and skips the key gets the "no key saved" reply. Routing chat through the account is the next piece of work and is not in this change.
- Key files: src/renderer-react/OnboardingView.jsx, src/renderer-react/GoogleSignInButton.jsx, src/renderer-react/CloudView.jsx, src/main/onboarding.js, scripts/selftest.js.
- Other OS action: run npm run test after syncing.
- Done on: Windows
## 2026-10-25 - Windows

- Settings now lists the Zuri models instead of supplier ids: Zuri Flash, Zuri Pro, Zuri Max, Zuri Code, Zuri Reason and Zuri Elite. Each one saves the provider key it runs on together with the model, so the model and the key that pays for it cannot drift apart. A model saved before this list existed still shows, marked "(current)", rather than appearing under a Zuri name it is not.
- Repaired two breaks in `server/src/app.js` that stopped the cloud server loading at all: the admin overview declared the model catalogue twice, and the chat handler lost its catalogue lookup entirely, so every signed-in chat would have thrown. Neither is a behaviour change. This file also carries unrelated in-progress image-model work, so it is not part of this change.
- Key files: `src/renderer-react/SettingsView.jsx`, `scripts/selftest.js`, `server/src/app.js`.
- Other OS action: run `npm run react:build && npm run selftest` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- A person's own prompts in the chat transcript now have a copy button, the same one Zuri's replies already carried. Only replies could be copied before, so reusing your own wording meant selecting it by hand. Both roles go through the one `copyMessage` path, so the "Copied" confirmation and the failure message behave the same for a prompt as for a reply.
- Key files: `src/renderer-react/ChatPanel.jsx`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Claude models can now use tools. The tool list was emptied for the Anthropic path and no Anthropic tool format existed, so switching to a Claude model silently removed web search, page fetch and document creation. The request now carries `{ name, description, input_schema }`, the stream reader collects `content_block_start` plus `input_json_delta` into tool calls, and the tool loop sends `tool_use` blocks back with `tool_result` blocks in the next user turn.
- `readFile` and `summarizeDocument` are offered in chat on every message, not only when web search is on, because they only read and so need no approval.
- Automations ask the model instead of guessing a tool from the prompt text. A schedule with no declared steps sends its prompt through the chat pipeline with its own allowed tools, and the answer is written into the run result under a new "Answer" heading. A caller with no model available keeps the old single-call plan.
- Four new self-test checks cover this with a fake Anthropic stream and a fake automation run, so none of it needs a network or a key.
- Key files: `src/main/providers/chat.js`, `src/main/scheduler.js`, `src/main/main.js`, `scripts/selftest.js`, `docs/deep-dive-vs-agent-clis.md`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- The Android APK is now on the live site. `server/src/downloads.js` already accepted `.apk`, but the deployed bundle predated that change, so `/api/downloads` returned only Windows and macOS. Rebuilt `server/public` and redeployed: the site now lists all three installers (`Zuri-0.1.0-Setup.exe`, `Zuri-0.1.0.dmg`, `Zuri-0.1.0.apk`) straight from the v0.1.0 GitHub release.
- Corrected the Power plan card: it claimed "the largest input and output limits", but Max holds the higher limits (128k input, 16k output, 240 requests a minute). Each card now states its real model weight and request guardrails from `server/src/models.js` and `server/src/limits.js`. Prices were already read from `/api/plans` and needed no change.
- Key files: `web/src/lib/format.js`, `server/public/**`.
- Other OS action: run `npm run web:build && npm run test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Fixed PostgreSQL usage events so model code, supplier, weighted quota tokens and supplier cost are stored for admin reporting. Added a repository regression test. Desktop Settings now lets users choose the local provider and model without editing the data folder, and the landing page correctly says there are four plans.
- Key files: `server/src/db.js`, `server/test/db.test.js`, `server/package.json`, `src/renderer-react/SettingsView.jsx`, `web/src/views/Landing.jsx`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Removed the Free cloud plan. Starter is now the paid entry plan and every new account starts with Starter; Zuri Flash (DeepSeek) is available from Starter. Existing database rows on Free are migrated to Starter before the retired plan is deleted.
- Updated plan limits, model gating, sign-up and landing copy, account fallbacks, desktop cloud plan display, preview data, and server tests so no customer-facing free tier remains.
- Key files: `server/src/plans.js`, `server/src/limits.js`, `server/src/db.js`, `server/src/models.js`, `server/db/schema.sql`, `web/src/**`, `src/renderer-react/CloudView.jsx`, `scripts/preview-web.mjs`, `server/test/**`.
- Other OS action: run `npm run web:build && npm run test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Added the privacy and data page (/privacy) and the terms and AI disclaimer page (/terms) to the web app, linked from every footer and from the sign-up and sign-in screens, and a data notice in desktop Settings under Providers and keys. They state that messages go to AI providers some of which operate in China and the United States, what Zuri Cloud stores (no message text), and that AI can be wrong. The wording is a plain-language draft and needs a lawyer's review, plus a real contact address, before launch.
- Key files: `web/src/views/LegalView.jsx`, `web/src/App.jsx`, `web/src/components/Footer.jsx`, `web/src/views/AuthView.jsx`, `src/renderer-react/SettingsView.jsx`.
- Other OS action: run `npm run web:build` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Zuri cloud models: customers pick Zuri-branded models (Zuri Flash, Zuri Pro, Zuri Max) and never see the supplier. The catalogue is a new `models` table (seeded once, then edited in the dashboard) mapping each Zuri name to a supplier, a supplier model, a dollar price per million tokens, a quota weight, a lowest plan and a rate factor. The supplier prices in the seed are placeholders: check them against each supplier price list before charging customers.
- `POST /api/chat` now takes a Zuri model code, refuses a model above the plan (403 PLAN_UPGRADE_REQUIRED), counts weighted tokens against the monthly quota, scales requests per minute by the model rate factor, and records the supplier cost of every request (`usage_events.cost_micro_usd`, `quota_tokens`, `model_code`). New `GET /api/models` lists models for the signed-in plan.
- New Max plan (NGN 40,000, 40M tokens, 240 requests per minute). Paystack needs a plan code in `PAYSTACK_PLAN_MAX` before it can be bought.
- New admin dashboard (Admin tab, shown to `users.is_admin` accounts only): revenue, supplier cost at `USD_NGN_RATE` (default 1600), margin, spend per model, model editor, and plan limits. Routes: `GET /api/admin/overview`, `PUT /api/admin/models`.
- Suppliers: set `MOONSHOT_API_KEY`, `ZAI_API_KEY` and `OPENAI_API_KEY` next to `DEEPSEEK_API_KEY` to switch on the other suppliers. A model whose supplier has no key fails instead of falling back to another supplier.
- Desktop agents also gained a per-agent provider setting (`src/main/store.js`, `src/main/providers/chat.js`, `src/renderer-react/AgentsView.jsx`); the next step is to replace the supplier names there with the Zuri model names.
- Key files: `server/src/models.js`, `server/src/app.js`, `server/src/db.js`, `server/src/server.js`, `server/src/config.js`, `server/db/schema.sql`, `server/test/models.test.js`, `web/src/views/AdminView.jsx`, `scripts/preview-web.mjs` (PREVIEW_ADMIN=1 shows the dashboard with sample data).
- Other OS action: run `npm run web:build && cd server && npm test` after syncing; the schema upgrades itself on the next server start.
- Done on: Windows

## 2026-10-24 - Windows

- The web app now wears the real Zuri icon (the same `zuri-icon.png` the desktop build ships) in the top bar, the hero badge, the account screens and the browser tab, and the landing page gained a motion layer: a three.js point globe and a tsparticles field over a Pexels texture, both lazy loaded and both paused when off screen or when reduced motion is requested.
- New `/signin` and `/signup` pages. They are separate addresses with their own layout (visual aside on desktop, colour band on phones), a Sign in / Create account switch, what the free plan includes, and the honest unconfigured-Google state. Google is the only method the server supports, so there is no email form to fill in.
- Footer on every page reads "Powered by Tijha" (plain text: the project has no Tijha URL to link to).
- Fixed two server bugs the new assets exposed: every response body was decoded as UTF-8 before being written, so PNG/JPEG responses came back as replacement characters and larger than the file (now copied as bytes, with a regression test); and the SPA fallback sat behind an extension check it could never pass, so `/signin` returned 404 (now extension-less routes get the app shell). `.jpg`/`.jpeg` were also missing from the static allowlist.
- Key files: `web/src/views/AuthView.jsx`, `web/src/views/Landing.jsx`, `web/src/components/{HeroBackdrop,ParticleField,ThreeScene,Footer,TopBar,Icons}.jsx`, `web/src/App.jsx`, `web/src/styles.css`, `web/public/**`, `server/src/serve.js`, `server/src/app.js`, `server/test/server.test.js`.
- `three` and `@tsparticles/{engine,slim}` are devDependencies: the web build bundles them, and electron-builder packs only `dependencies`, so the installed desktop app does not grow.
- Other OS action: run `npm install && npm run web:build && cd server && npm test` after syncing, then `npm run cloud:deploy`.

## 2026-10-24 - Windows

- Restyled the Zuri Cloud web app onto the desktop app's own design tokens instead of a separate purple palette: the navy `#040130` canvas with `#0a0548` cards in dark mode, the ice-blue `#eef3f9` canvas with white cards in light mode, the accent-tinted selected state (`#2a23a0` dark, `#d4e5ff` light), 44px controls on a 12px radius, 16px cards, pill chips and the dashed centred empty state. The signed-in sidebar is now the desktop list panel (`surface-secondary` with accent-tinted nav rows), and pages carry the same top-right accent wash.
- The brand mark and the favicon now use the desktop blue (`#3478e5`) and the tile glyph inherits `accent-foreground`, so it stays legible on the lavender dark-mode accent.
- Theme is applied from `web/src/main.jsx` before the first render (an inline pre-paint script is refused by the server's CSP), and blocked storage no longer stops the page booting.
- Key files: `web/src/styles.css`, `web/src/main.jsx`, `web/src/lib/theme.js`, `web/src/components/Icons.jsx`, `web/index.html`, `server/public/**`.
- Other OS action: run `npm run web:build && cd server && npm test` after syncing, then `npm run cloud:deploy`.
- Done on: Windows

## 2026-10-24 - Windows

- The site now hands out the desktop app itself instead of linking to a GitHub releases page: `GET /api/downloads` lists the installers this server actually holds, and `GET /downloads/<file>` sends them with `content-disposition: attachment`, so a click saves `Zuri-0.1.0-Setup.exe` rather than opening a tab. The landing cards, the footer and the dashboard sidebar all read that one endpoint through a cached fetch in `web/src/lib/downloads.js`; a platform with no build says "Not available yet" rather than showing a dead link.
- The installers are deliberately not in git: the Windows build is 140 MB, past GitHub's 100 MB per-file limit. `server/downloads/` is ignored, and `npm run cloud:deploy` now stages the newest `release/*.exe` and `release/*.dmg` into the uploaded image, so the deployed site always offers the build that was just produced.
- `package.json` gained a real macOS target (`build.mac`, dmg for arm64 and x64, `npm run dist:mac`). A .dmg cannot be built on Windows, so the macOS card stays unavailable until someone runs that script on a Mac and drops the file into `release/`.
- `server/src/downloads.js`, `server/src/app.js`, `server/test/server.test.js` (listing, attachment headers, and a refused `%2e%2e%2f` traversal), `scripts/deploy-cloud.mjs`, `web/src/lib/downloads.js`, `web/src/components/{DownloadList,DownloadLink,Footer}.jsx`, `web/src/views/{Landing,Dashboard}.jsx`, `web/src/styles.css`, `server/public/**`.
- Other OS action: run `npm run web:build && cd server && npm test` after syncing, then `npm run cloud:deploy` from a checkout that has `release/` (or copy an installer into `server/downloads/`) or the site will report the desktop app as unavailable.
- Done on: Windows

## 2026-10-24 - Windows

- Added desktop download cards to the Zuri Cloud landing page, footer, and signed-in dashboard. The Windows card links to the GitHub releases page; macOS is shown as not published because the current build only targets Windows.
- Key files: `web/src/lib/downloads.js`, `web/src/views/Landing.jsx`, `web/src/components/Footer.jsx`, `web/src/views/Dashboard.jsx`, `web/src/styles.css`.
- Other OS action: run `npm run web:build` and `npm --prefix server test` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Fixed the landing sign-in card: the Google button slot kept its 44px height even on a server with no `GOOGLE_CLIENT_ID`, leaving a blank hole above the notice. The slot now renders only while a button lives in it, and the unconfigured state is a framed notice that says what to set.
- Added `npm run cloud:deploy` (`scripts/deploy-cloud.mjs`). Running `railway up` from the repo root uploads the desktop app, so the service builds Electron and the live site answers 502; this script builds the web bundle, copies `server/` to a scratch folder outside the repo and uploads that, which is the only upload path that ships the Dockerfile in `server/`.
- Key files: `web/src/components/GoogleSignIn.jsx`, `web/src/styles.css`, `scripts/deploy-cloud.mjs`, `package.json`, `server/public/**`.
- Other OS action: run `npm run web:build && cd server && npm test` after syncing. Deploy with `npm run cloud:deploy`, never `railway up` from the repo root.
- Done on: Windows

## 2026-10-24 - Windows

- Rebuilt the Zuri Cloud web dashboard as a React app (`web/`, Vite, React 19) instead of plain HTML and JS. It has a signed-out page (hero, sign-in card, features, Naira plans) and a signed-in shell with Overview, Usage and limits, Plans and Billing, a sidebar on desktop and a fixed bottom tab bar on phones, and a light/dark toggle. `npm run web:build` builds it into `server/public`.
- The server now serves that bundle from `public/` with a path guard (traversal and unknown extensions are refused) and falls back to the app shell for extension-less routes. Added `server/Dockerfile` so the Railway service builds this folder reproducibly.
- Fixed the live 502: the Railway domain had no target port, so nothing was routed to the app. The domain now targets 8080.
- Key files: `web/src/**`, `vite.web.config.mjs`, `server/src/app.js`, `server/public/**`, `server/Dockerfile`, `server/test/server.test.js`.
- Other OS action: run `npm run web:build` then `cd server && npm test` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Added the Zuri Cloud web dashboard (served by the cloud server at `/`: Google sign-in, usage, plans, Paystack checkout, payment history) and `npm run migrate` in `server/` to create the database tables. A PostgreSQL database must still be added on Railway and `DATABASE_URL` set.
- Key files: `server/public/index.html`, `server/public/dashboard.js`, `server/src/migrate.js`, `server/src/app.js`.
- Other OS action: none for the desktop app; in `server/` run `npm test`.
- Done on: Windows

## 2026-10-24 - Windows

- Added a saved answer style. Settings now offers length, tone, explanation level, layout and optional standing instructions, and every chat request carries them as one instruction block, so replies keep one shape across models. The newest reply also gained Shorter, More detail, Explain simply and As a table rewrite buttons, which send a short follow-up in the same thread and offer to save the habit as the default after two uses.
- Key files: `src/main/store.js`, `src/main/providers/chat.js`, `src/renderer-react/SettingsView.jsx`, `src/renderer-react/ChatPanel.jsx`, `scripts/selftest.js`.
- Other OS action: run `npm run test` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Isolated source and test launches from the installed app's production taskbar identity, and moved packaged Zuri to a fresh identity that cannot group with the stale Electron entry. Tests no longer recreate an Electron shortcut under Zuri's identity or overwrite installed Zuri shortcuts.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Kept the sidebar Recents list synchronized with chat history changes, so clearing or deleting conversations removes them from both places immediately.
- Key files: `src/renderer-react/Sidebar.jsx`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Removed a stale Electron Start Menu shortcut only when it points to `electron.exe` while carrying Zuri's AUMID. The duplicate identity made Windows select Electron's atom for Zuri's running taskbar group even though the executable and window icons were correct.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Fixed the remaining Electron taskbar icon fallback by pointing Windows taskbar metadata at the installed Zuri executable. Windows cannot load an icon from Electron's internal app.asar path, while Zuri.exe contains the correct embedded icon.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Assigned the packaged Zuri ICO and AUMID directly to the running BrowserWindow taskbar button, fixing live taskbar buttons that still displayed Electron after the shortcut icon was corrected.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Refreshed the packaged Start Menu and desktop shortcuts with the embedded Zuri executable icon and app identity, repairing stale Electron taskbar grouping after upgrades.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Synchronized Electron's native title bar and application menu with the saved light/dark app theme at startup and when the theme toggle changes.
- Key files: `src/main/main.js`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Fixed the packaged ExcelJS dependency tree by shipping `es-abstract-get` and its small runtime dependency chain as extra resources, and adding packaged runtime resources to Node's module lookup path. This prevents the installed app from failing at startup with missing abstract-operation modules.
- Key files: `package.json`, `src/main/bootstrap.js`, `scripts/selftest.js`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

## 2026-10-24 - Windows

- Made `call-bind-apply-helpers` an explicit production dependency so electron-builder includes it at the package root. This fixes the packaged app startup crash raised while loading Excel support.
- Added a packaged-app bootstrap that exposes electron-builder's nested helper directory before loading the main process.
- Key files: `package.json`, `package-lock.json`, `src/main/bootstrap.js`.
- Other OS action: run `npm install && npm run react:build && npm run dist` after syncing.
- Done on: Windows

- Added the Zuri Cloud desktop account screen with Google Identity Services sign-in, encrypted main-process session storage, usage meter, plan cards, payment history, checkout launch, and configurable cloud server URL. Added a public Railway config endpoint that exposes only the Google client ID needed by the desktop sign-in button.
- Key files: `src/renderer-react/CloudView.jsx`, `src/main/cloud-session.js`, `src/main/main.js`, `src/main/preload.js`, `src/main/store.js`, `src/renderer-react/App.jsx`, `src/renderer-react/Sidebar.jsx`, `src/renderer-react/SettingsView.jsx`, `server/src/app.js`, `server/src/server.js`.
- Other OS action: run `npm install && npm test` after syncing.
- Done on: Windows

- Added Paystack recurring checkout initialization, server-side verification, HMAC-SHA512 webhook validation, idempotent payment fulfillment, subscription renewal/status updates, and protected billing data.
- Key files: `server/src/paystack.js`, `server/src/app.js`, `server/src/db.js`, `server/src/config.js`, `server/db/schema.sql`, `server/test/server.test.js`.
- Other OS action: run `npm install --prefix server && npm --prefix server test` after syncing, then apply `server/db/schema.sql` to the Railway database.
- Done on: Windows

- Added the authenticated Railway chat proxy with DeepSeek forwarding, PostgreSQL-backed atomic token reservations, actual usage commits, failed-request releases, and free-plan request guard enforcement.
- Key files: `server/src/app.js`, `server/src/db.js`, `server/src/deepseek.js`, `server/src/config.js`, `server/db/schema.sql`, `server/test/server.test.js`.
- Other OS action: run `npm install --prefix server && npm --prefix server test` after syncing.
- Done on: Windows

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
## 2026-10-25 - Windows

- Removed the free cloud plan. New accounts start on paid Starter, Zuri Flash requires Starter, and all plan limits, checkout copy, account fallbacks, model gating, schema migration, and tests now use the four paid plans.
- Key files: `server/src/plans.js`, `server/src/limits.js`, `server/src/db.js`, `server/db/schema.sql`, `server/src/models.js`, `web/src/views/Landing.jsx`, `web/src/views/AuthView.jsx`, `web/src/components/PlanCard.jsx`.
- Other OS action: run `npm run web:build` and `npm run server:test` after syncing.
- Done on: Windows
## 2026-10-25 - Windows

- Kept the existing Kimi and GLM-backed Zuri models and added Zuri Code (OpenAI Codex), Zuri Reason (Claude Sonnet), and Zuri Elite (Claude Opus). Added the Anthropic Messages API adapter and `ANTHROPIC_API_KEY` configuration. Customer pages now explain weighted token consumption and show the monthly NGN plan prices.
- Key files: `server/src/models.js`, `server/src/deepseek.js`, `server/src/server.js`, `server/src/config.js`, `server/db/schema.sql`, `web/src/views/Landing.jsx`, `web/src/views/UsageView.jsx`, `web/src/lib/format.js`.
- Other OS action: run `npm run web:build && npm --prefix server test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Improved release downloads by highlighting the visitor's likely desktop platform, showing the published installer version, selecting the matching installer in footer links, and linking to the GitHub release notes.
- Key files: `server/src/downloads.js`, `server/test/server.test.js`, `web/src/lib/downloads.js`, `web/src/components/DownloadList.jsx`, `web/src/components/DownloadLink.jsx`, `web/src/styles.css`.
- Other OS action: run `npm run react:build && npm run server:test` after syncing.
- Done on: Windows

## 2026-10-25 - Windows

- Added a manual GitHub Actions workflow that builds and publishes the Windows installer alongside the existing macOS workflow. Documented the release secret and the fact that Android needs a separate application target before an APK or AAB can be published.
- Key files: `.github/workflows/build-windows.yml`, `README.md`.
- Other OS action: no source build required; run the workflow after syncing when `RELEASES_TOKEN` is configured.
- Done on: Windows
## 2026-10-25 - Windows

- Added a Capacitor Android target for the Zuri Cloud dashboard. The Android build embeds the production API URL, permits only the Capacitor localhost origins at the cloud API, builds a debug APK in GitHub Actions, and publishes `.apk` assets alongside Windows and macOS releases. The website now lists Android downloads automatically.
- Key files: `capacitor.config.json`, `android/**`, `scripts/build-android.mjs`, `.github/workflows/build-android.yml`, `server/src/downloads.js`, `server/src/app.js`, `web/src/lib/api.js`, `web/src/lib/downloads.js`, `package.json`.
- Other OS action: run `npm install && npm run android:build` after syncing. A Java 21 JDK and Android SDK are required for the native build.
- Done on: Windows

## 2026-10-26 - Windows

- The composer's model control is now the model name and a chevron, with no pill: the row already holds round buttons, and a fourth filled shape read as another action rather than as the name of the model that will answer. It still opens the same six-name list, still sits beside Send, and keeps its keyboard focus ring.
- Key files: `src/renderer-react/ChatPanel.jsx`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build` after syncing. No dependency, database or catalogue change.
- Done on: Windows
## 2026-10-28 - Windows

- Free access is removed from the cloud service. New accounts receive a pending Starter subscription so they can open billing and pay, but chat and model access return a subscription-required response until Paystack confirms payment. The database status check now supports pending, and successful checkout activates it.
- The landing and account screens now describe paid access clearly instead of implying that account creation grants a Starter allowance.
- Key files: server/db/schema.sql, server/src/db.js, server/src/app.js, web/src/views/Landing.jsx, web/src/views/OverviewView.jsx, web/src/views/BillingView.jsx.
- Other OS action: run `npm run test` after pulling these source changes. No dependency changes.
- Done on: Windows

## 2026-10-28 - Windows

- Cloud checkout now keeps Starter visible until payment activates it, refuses top-ups for unpaid accounts, records recurring Paystack charges, and consumes purchased tokens once rather than restoring them each period. Document edits require explicit approval. Autopilot supports preview-only runs and bounded retries. Saved chats can be renamed, and signup explains the paid-plan step.
- Key files: server/db/schema.sql, server/src/app.js, server/src/db.js, src/main/tools/index.js, src/main/scheduler.js, src/main/store.js, src/renderer-react/AutomationsView.jsx, src/renderer-react/CloudView.jsx, src/renderer-react/HistoryView.jsx, web/src/views/AuthView.jsx, web/src/views/Dashboard.jsx.
- Other OS action: run "npm test" after syncing.
- Done on: Windows

## 2026-10-28 - Windows

- Desktop chat prompts can now be edited back into the composer without changing the saved transcript. Ask and unattended Autopilot runs are limited to read-only tools, while Act keeps the existing confirmation gate for writes. The Word task pane now shows and refreshes the exact document context sent to Zuri. The web download grid can retry an unavailable lookup without a full page reload.
- Key files: src/renderer-react/ChatPanel.jsx, src/main/providers/chat.js, src/main/scheduler.js, src/addin/taskpane.js, web/src/components/DownloadList.jsx, web/src/lib/downloads.js, scripts/selftest.js.
- Other OS action: run `npm test` and `npm run web:build`.
- Done on: Windows

## 2026-10-28 - Windows

- The web chat now supports editing a saved prompt back into the composer, regenerating the latest reply, and searching saved conversations by title or message text. Search is owner-scoped, capped and parameterized, and the browser control is clearable and accessible.
- Key files: web/src/views/ChatView.jsx, web/src/components/ConversationSearch.jsx, web/src/lib/api.js, web/src/styles.css, server/src/app.js, server/src/db.js, server/test/conversations.test.js, scripts/selftest.js.
- Other OS action: run `npm test` and `npm run web:build`.
- Done on: Windows

## 2026-10-28 - Windows

- Android/web chat now restores unsent drafts from local storage and adds a Share message action using the Android share sheet, with a copy fallback when sharing is unavailable. No dependency changes. Real biometric lock remains pending because the Capacitor app has no biometric plugin or native bridge.
- Key files: web/src/views/ChatView.jsx, web/src/lib/drafts.js, web/src/lib/share.js, scripts/selftest.js.
- Other OS action: run `npm test` and `npm run web:build`.
- Done on: Windows

## 2026-10-28 - Windows

- Desktop AI actions now use the signed-in Zuri Cloud route, local provider-key settings and IPC channels are removed, onboarding ignores legacy key fields, Android builds default to the Railway HTTPS API, and image generation no longer calls supplier APIs from the desktop process.
- Key files: src/main/providers/chat.js, src/main/main.js, src/main/onboarding.js, src/main/preload.js, src/renderer-react/SettingsView.jsx, scripts/firstrun.js, scripts/build-android.mjs, .github/workflows/build-android.yml.
- Other OS action: run `npm test`, `npm run android:build`, and rebuild the platform installer.
- Done on: Windows

## 2026-10-28 - Windows

- The desktop composer no longer shows native textarea scroll arrows in narrow windows, and its model picker uses the shorter model name below 700px so the message field keeps more room.
- Key files: `src/renderer-react/ChatPanel.jsx`, `src/renderer-react/app.css`, `scripts/selftest.js`.
- Other OS action: run `npm run react:build` and `npm run selftest` after syncing.

## 2026-10-29 - Windows

- Reworked the web Admin dashboard into calm, focused sections for business stats, people and service health, models and prices, and plans and limits. AdminView now coordinates separate AdminStats, AdminPeople, AdminModels, and AdminPlans files. Existing account and model actions are unchanged.
- Key files: `web/src/views/AdminView.jsx`, `web/src/views/AdminPeople.jsx`, `web/src/views/AdminStats.jsx`, `web/src/views/AdminModels.jsx`, `web/src/views/AdminPlans.jsx`, `web/src/styles.css`.
- Other OS action: run `npm run test` and `npm run web:build` after syncing.
- Done on: Windows

## 2026-10-29 - Windows

- Fixed the Admin layout so the page uses the full available workspace instead of the shared 1200px content cap. Added consistent vertical section spacing and readable minimum widths for People, Models and Plans tables; narrow screens scroll each table inside its own region instead of squeezing columns.
- Key files: `web/src/views/AdminView.jsx`, `web/src/views/AdminPeople.jsx`, `web/src/views/AdminModels.jsx`, `web/src/views/AdminPlans.jsx`, `web/src/styles.css`.
- Other OS action: run `npm run test` and `npm run web:build` after syncing.
- Done on: Windows
- Done on: Windows

## 2026-10-29 - Windows (account names and calmer greeting)

- Signed-in people can now change the name Zuri uses from the web Account page or desktop Settings. The update is owner-scoped, trimmed and capped at 60 characters.
- The web overview greeting has more space above it so it does not sit against the page header.
- Key files: server/src/app.js, server/src/db.js, server/test/admin-users.test.js, web/src/lib/api.js, web/src/views/AccountView.jsx, web/src/views/OverviewView.jsx, web/src/styles.css, src/main/main.js, src/main/preload.js, src/renderer-react/SettingsView.jsx.
- Other OS action: run "npm run test". Railway must redeploy for the account update route and rebuilt web bundle. Rebuild the Windows installer with "npm run dist".
- Done on: Windows

## 2026-10-29 - Windows

- Fixed Word Office writes that were rejected when a generated paragraph carried a display-style name. Built-in styles now use Word's portable `styleBuiltIn` values, and unsupported style labels no longer cancel the whole text insertion.
- Key files: src/addin/taskpane.js, scripts/selftest.js.
- Other OS action: run `npm run test` after syncing. No dependency changes.
- Done on: Windows

## 2026-10-29 - Windows

- Admin deep links now render the admin screen before the API permission check, and expired or non-admin sessions receive a clear recovery message. The rebuilt web bundle includes the change.
- Key files: web/src/views/Dashboard.jsx, web/src/views/AdminView.jsx, scripts/selftest.js, server/public/index.html, server/public/assets/index-W9g1ek5t.js.
- Other OS action: run `npm run test` after syncing. No dependency changes.
- Done on: Windows

## 2026-10-29 - Windows (one Zuri mark on the phone too)

- The Android app was the last surface still wearing the stock Capacitor artwork: a grey cross on a white plate for the launcher and a blue cross on the splash. It now uses the same navy plate and white speech bubble as the Windows app, the web site, the Office add-in and the favicon.
- Launcher, round launcher, the Android 8+ adaptive foreground and all eleven splash sizes are now generated from src/main/assets/zuri-icon.png by scripts/build-android-icons.py, so the phone cannot drift from the desktop again.
- The adaptive icon plate is brand navy #0D1B3A instead of white, and the Android theme colours are defined in res/values/colors.xml for the first time. Without that file Android fell back to the Capacitor library's stock indigo #3F51B5 and pink #FF4081 accent.
- Two unused Capacitor template vectors were deleted (drawable/ic_launcher_background.xml with #26A69A teal, drawable-v24/ic_launcher_foreground.xml with the white cross). Nothing referenced either; the adaptive icon is defined by mipmap-anydpi-v26 plus the mipmap PNGs.
- scripts/selftest.js now asserts the Android launcher, adaptive and splash art exist, that the plate and theme are the brand navy, and that the Capacitor teal has not come back.
- Key files: scripts/build-android-icons.py, android/app/src/main/res/**, updates.md, scripts/selftest.js.
- Other OS action: run "npm run test". No dependency changes. Rebuild the APK with the normal Android build so the new icons and splash are packaged.
- Done on: Windows

## 2026-10-29 - Windows (the rewrite row reaches the browser chat)

- The web chat now draws the four one-press rewrites the desktop has shown under its newest reply since 24 October: Shorter, More detail, Explain simply and As a table. The cloud chat had only copy, share and regenerate, which is why the same conversation offered them in the app and not in the browser.
- The four labels moved out of src/renderer-react/ChatPanel.jsx into a shared src/renderer-react/answerAdjustments.js that both surfaces import, so a rewrite cannot go missing from one of them again.
- Pressing one sends the rewrite as a follow-up turn in the same chat, so the earlier answer stays on screen to compare against. It no longer clears a half-typed composer message or a file waiting to go, and it no longer appends the composer's answer-length rule, which used to send the model two opposite lengths at once.
- The row is hidden while a reply is still arriving, under any reply but the newest, and under a picture reply or with a picture model chosen, because a rewrite there would swap the picture for words.
- scripts/selftest.js now checks that both surfaces import the one shared list, that the web row is drawn from it, and that it stays limited to the newest reply.
- Key files: src/renderer-react/answerAdjustments.js, src/renderer-react/ChatPanel.jsx, web/src/views/ChatView.jsx, web/src/styles.css, scripts/selftest.js, server/public/index.html, server/public/assets.
- Other OS action: run "npm run test". No dependency changes. The cloud server must redeploy for the browser chat to carry the change.
- Done on: Windows

## 2026-10-29 - Windows (0.2.3 is published for Windows, macOS and Android)

- The download page had been offering nothing at all: the ZURI_RELEASE_REPO variable on Railway held the placeholder text "<only to point downloads at a different releases repo>" instead of a repository name. downloads.js read it as a configured repo, every GitHub call 404ed, the failure was swallowed by the cache fallback, and the page rendered no cards. The variable now names King-odysseus/zuri-releases.
- GITHUB_TOKEN on Railway was empty, so the release list was fetched anonymously from a shared container IP under the 60-requests-an-hour limit. A failed refresh silently kept the old cached list, which is why the page stayed on 0.2.2 after 0.2.3 was uploaded. The variable now carries a token, which lifts the limit to 5000 an hour. It is the account OAuth token; replace it with a fine-grained read-only token for this one repository when convenient.
- Version is 0.2.3 (Android versionCode 4) because the 0.2.2 files predate the colour, sync and composer work and nobody holding that download could tell the new files apart.
- The Windows installer and the Android APK were built on this machine (release/Zuri-0.2.3-Setup.exe, release/Zuri-0.2.3.apk) and published with npm run release:publish. The macOS dmg cannot be built on Windows, so the existing Build macOS installer workflow produced and published it: release/Zuri-0.2.3.dmg, 263 MB.
- The v0.2.3 release was created empty before any build ran, so the three publishers could not race each other into "release already exists". Stale 0.2.2 installers were removed from release/ first, because release:publish uploads every installer it finds there and the site takes the first match per platform.
- Key files: package.json, package-lock.json, android/app/build.gradle, README.md, updates.md.
- Other OS action: run "npm run test". No dependency changes.
- Done on: Windows
## 2026-10-30 - Windows (repair desktop installer updates)

- Excluded Android build output from desktop packages and added a recovery path for affected older Windows installations that preserves app data.
- Key files: package.json, scripts/installer.nsh.
- Other OS action: no dependency changes; run the appropriate build and checks before packaging.
- Done on: Windows

## 2026-10-30 - Windows (Office plans can see every Excel tab and PowerPoint waits for its shapes)

- The Office pane used to read only the active Excel worksheet, even though its operation format already accepted a sheet name. A workbook-wide bounded context now lists every non-empty sheet, its exact used area, a preview, and existing formulas, so Zuri can produce one plan for Dashboard, Monthly, Transactions and other tabs without guessing what is hidden on another tab.
- Excel regression coverage now proves that a named-sheet write lands on Monthly while the active sheet remains Dashboard, and the existing width contract remains physical enough for Office.js.
- PowerPoint multi-slide title and shape edits now load shape names and synchronize before inspecting shapes.items. This removes the batch timing failure that made edits work on some slides but fail on others.
- Key files: src/addin/taskpane.js, scripts/selftest.js.
- Other OS action: run npm run test before packaging or deploying the Office pane.
- Done on: Windows

## 2026-10-30 - Windows (chat can save and edit shared memories)

- Added a cloud `createMemory` chat tool so a person can say "remember this" in the browser, Android bundle, or desktop cloud chat.
- Added PATCH memory editing and Edit controls beside the existing Delete control on Account.
- The tool uses the signed account route, so no provider key or memory data is kept in the desktop process.
- Checked: memory route test, React production build, and the full `npm test` suite. The first full run found the expected tool-sync assertion, which was updated; `npm run sync:check` then passed.
- Key files: server/src/app.js, server/src/db.js, server/test/memories.test.js, web/src/lib/api.js, web/src/views/AccountView.jsx, web/src/views/ChatView.jsx, src/main/tools/index.js, src/main/providers/chat.js, src/main/main.js, scripts/check-chat-sync.mjs.
- Other OS action: run `npm test` before deploying the cloud server. No new dependency or database migration is needed.
- Done on: Windows

## 2026-10-30 - Windows (guarded incognito chats and local Markdown export)

- Web and Android chats can start an incognito conversation. They do not create or update an account conversation, and the transcript is discarded with the page.
- Desktop incognito turns are marked device-only, so the existing cloud sync excludes them. Turning the mode on starts a fresh local chat to avoid mixing private and saved turns.
- Both chat surfaces can export the visible transcript as a local Markdown file. No server storage or new provider request is used.
- Checked: React production build and desktop self-test pass.
- Key files: web/src/views/ChatView.jsx, src/renderer-react/ChatPanel.jsx, updates.md.
- Other OS action: run `npm test`; no new dependency, server route, or database migration is needed.
- Done on: Windows

## 2026-10-30 - Windows (project PDFs become bounded searchable context)

- Project files now extract selectable PDF text in the shared web project screen, which is also the Android bundle. OCR is deliberately off, extraction stops after 15 seconds, and stored context is capped at 20,000 characters so a PDF cannot turn every later chat into an unbounded request.
- Pictures still use the existing upload path. Empty, scanned, encrypted or malformed PDFs are refused with a plain message instead of being uploaded without usable context.
- Checked: `npm run web:build` passes. The build keeps the PDF parser in a lazy chunk, so normal chat loading does not pay its size.
- Key files: web/src/views/ProjectsView.jsx, server/public/index.html, server/public/assets/.
- Other OS action: deploy the rebuilt web bundle with `npm run cloud:deploy`; Android picks it up on the next `npm run android:build`. No new package was added.
- Done on: Windows

## 2026-10-30 - Windows (typos are interpreted and empty replies recover)

- Chat prompts now interpret obvious spelling mistakes, missing letters and phonetic typing from context, while asking for clarification when two meanings would change the answer.
- Desktop and web chats retry one bounded empty reply, including the server's explicit `CHAT_EMPTY_REPLY` response, before showing an error. The recovery instruction is not saved as part of the conversation.
- Checked: `npm run selftest` passes, `npm run web:build` passes, and `npm run sync:check` passes. `npm run server:test` still fails at its existing dashboard shell assertion because `/` returns 404 in the local test app; the text and chat tests are not reached after that failure.
- Key files: src/main/providers/chat.js, server/src/text.js, web/src/views/ChatView.jsx, scripts/selftest.js, scripts/check-chat-sync.mjs, server/public/index.html, server/public/assets/index-Df-gONAz.js.
- Other OS action: run `npm run web:build` before deploying the browser bundle.
- Done on: Windows

## 2026-10-30 - Windows (cloud reminders use the in-app notification inbox)

- The earlier email-based reminder sweep was replaced by durable unread account notifications. Reminder events are now consumed by the Notifications view after reconnecting.
- Checked: `npm test` passes.
- Key files: server/db/schema.sql, server/src/db.js, server/src/reminders.js, web/src/views/NotificationsView.jsx.
- Other OS action: deploy the cloud service and rebuilt web bundle. Native OS alerts while fully closed still need a push provider.
- Done on: Windows

## 2026-10-30 - Windows (closed-app reminders become in-app notifications)

- Cloud reminder and automation runs now write durable unread notifications to the account instead of sending reminder email.
- The web dashboard and Android bundle have a Notifications view that reads the account inbox after reconnecting and marks it read.
- Checked: `npm run server:test` and `npm run web:build` pass.
- Key files: server/db/schema.sql, server/src/db.js, server/src/reminders.js, server/src/automations.js, server/src/app.js, web/src/lib/api.js, web/src/views/NotificationsView.jsx, web/src/views/Dashboard.jsx.
- Other OS action: run `npm run server:test` and deploy the cloud service plus rebuilt web bundle. Native OS alerts while fully closed still need a push provider.
- Done on: Windows

## 2026-10-30 - Windows (push notification registration and delivery adapters)

- Added authenticated device registration and account-wide notification preferences for web, Android and Windows.
- Web Push uses VAPID, Android uses the Capacitor push plugin with Firebase delivery, and Windows uses the WNS channel adapter when its app identity credentials are configured. Durable in-app notifications remain the fallback when a provider is off.
- Checked: `npm run server:test` and `npm run web:build` pass. `npm run android:build` synced the Capacitor plugin and manifest, but the native Gradle step needs a JDK on the build machine.
- Key files: server/db/schema.sql, server/src/push.js, server/src/app.js, server/src/db.js, web/src/lib/push.js, web/public/push-sw.js, android/app/src/main/AndroidManifest.xml.
- Other OS action: run `npm install` and `npm run android:build`; configure VAPID, Firebase and WNS deployment secrets without committing them.
- Done on: Windows

## 2026-10-30 - Windows (light ChatGPT-style chat presentation)

- Refreshed desktop and web chat surfaces with faded blue prompt bubbles, open assistant replies, softer hover states and a light-blue logo badge.
- Added model capability metadata so desktop image attachments explain when the selected model cannot read pictures; supported models are labelled in the picker.
- Checked: `npm run react:build`, `npm run web:build` and the full `npm test` suite.
- Key files: src/renderer-react/app.css, src/renderer-react/ChatPanel.jsx, src/renderer-react/SignInView.jsx, src/renderer-react/zuriModels.js, web/src/styles.css.
- Other OS action: run `npm run react:build` and `npm run web:build` before deploying or packaging.
- Done on: Windows

## 2026-10-30 - Windows (blue chat logo tile)

- Recolored the rounded square behind the white Zuri chat mark to the brand blue while preserving the original mark shape.
- Checked: `npm run react:build`, `npm run smoke`, `npm run selftest` and `npm run dist` pass.
- Key files: src/renderer-react/assets/zuri-logo.png.
- Other OS action: run `npm run react:build` before packaging or deploying.
- Done on: Windows

## 2026-10-30 - Windows (reference sign-in layout)

- Matched the desktop sign-in screen to the cloud reference with the shared photo hero, trust chips, account tabs, compact form card and footer. Narrow desktop windows collapse to the same card-first mobile layout.
- Checked: `npm run react:build`, `npm run web:build`, `npm run smoke`, `npm run selftest` and `npm run dist` pass.
- Key files: src/renderer-react/SignInView.jsx, src/renderer-react/CloudAuthForm.jsx, src/renderer-react/app.css, src/renderer-react/assets/auth-team.jpg.
- Other OS action: run `npm run react:build` before packaging or deploying.
- Done on: Windows

## 2026-11-04 - Windows (MCP connector support)

- Added validated MCP server settings, a bounded non-shell stdio client, tool discovery and approval-gated tool calls. Plugins can add, enable, test and remove local connectors; discovered names are scoped to their server.
- Checked: `npm test` passes, including a fake-server handshake, discovery, call and approval regression check.
- Key files: src/main/mcp/client.js, src/main/store.js, src/main/tools/index.js, src/main/providers/chat.js, src/main/main.js, src/renderer-react/PluginsView.jsx, scripts/selftest.js.
- Other OS action: run `npm test` before using the MCP connector UI. No new dependency was added.

## 2026-11-04 - Windows (Word document and Office add-in reliability)

- Word document creation now accepts equivalent provider argument shapes such as `format: "word"`, `document`, `body`, and flattened document fields, while preserving the canonical `docx` path. PowerPoint add-in styling now resolves semantic title placeholders when copied slides rename them.
- Added executable Word and PowerPoint Office batch regressions and a cloud document-route alias regression.
- Checked: `npm test` passes, including the React build, all server tests, Electron smoke, selftest, first-run, demos and chat sync. Direct Word and PowerPoint package creation and editing checks also pass.
- Key files: src/main/tools/index.js, server/src/app.js, src/addin/taskpane.js, scripts/selftest.js, server/test/documents.test.js.
- Other OS action: run `npm test` before packaging or deploying. No new dependency was added.
- Done on: Windows

## 2026-11-04 - Windows (Office starter prompts use the live file)

- Added a browser-safe intelligence layer for the Office pane. After the pane reads the current workbook, document or deck, its starter prompts now reflect the facts it found: formulas, tables and sheets in Excel; selection, paragraph count and headings in Word; selection, slide count and empty slides in PowerPoint.
- The intelligence layer is deterministic and read-only. It does not change the existing reviewed-operation flow, and the full context still goes to the model when the person sends a message.
- Added self-test coverage for all three Office hosts and served the new pane asset through the local HTTPS add-in server.
- Key files: src/addin/intelligence.js, src/addin/taskpane.js, src/addin/taskpane.html, src/main/addin.js, scripts/selftest.js.
- Other OS action: none beyond the usual test/build workflow. Rebuild the desktop installer before distributing the change.
- Done on: Windows

