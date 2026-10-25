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
