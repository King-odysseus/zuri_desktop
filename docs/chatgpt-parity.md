# Zuri and ChatGPT: what ChatGPT actually does, and what Zuri could borrow

Research note, 2026-10-28. A companion to `docs/deep-dive-vs-agent-clis.md`, which
compares Zuri against coding agents. This one compares Zuri against the consumer
product it is most often measured by: ChatGPT itself.

Two sources of truth, kept separate on purpose:

- **ChatGPT behaviour** comes from OpenAI's own documentation at
  `learn.chatgpt.com`, read on 2026-10-28. The pages used are named in each
  section. Promotion text and second-hand blog posts were not used.
- **"Zuri today"** was checked in this repository, with `file:line`. Where a
  feature is absent, the grep that proves it is described, not guessed.

Anything I could not confirm is in section 7 instead of being asserted.

---

## 0. The short answer

Four things stand out once the two are read side by side.

1. **Zuri throws away the reply it regenerates.** ChatGPT's regenerate keeps the
   old answer and lets you move between them. Zuri deletes it. This is the single
   most visible difference in day-to-day use, and it is a store change, not a
   redesign (`src/main/store.js:1282`, `removeTrailingReply`).
2. **Zuri has no memory layer at all.** ChatGPT carries facts between chats,
   shows them, and lets you switch them off per chat. Zuri starts from zero every
   time. This is the biggest missing capability and the most expensive to build.
3. **The organisation layer is thin.** ChatGPT groups, pins, archives, marks
   unread and searches inside a chat. Zuri's sidebars are one flat "Recents"
   list (`web/src/views/ChatView.jsx:802`), with rename on the web and nothing
   else.
4. **Most of the small niceties are cheap.** Restoring the previous prompt with
   ArrowUp, Enter/Esc on an approval, drafts that survive navigation, and a
   notification row that can actually be marked read are each an afternoon.

---

## 1. The chat screen itself

Source: `learn.chatgpt.com/docs/reference/commands.md` and
`/docs/reference/settings.md`.

| Behaviour | Zuri today | Evidence |
| --- | --- | --- |
| Enter sends; a setting makes Ctrl+Enter the send key for multiline prompts | Enter sends, Shift+Enter breaks the line, no setting | `src/renderer-react/ChatPanel.jsx:740`, `web/src/views/ChatView.jsx:758` |
| ArrowUp in an empty composer restores the previous prompt | Absent. No ArrowUp handler anywhere; the only ArrowUp is the send icon | `ChatPanel.jsx:1385` (icon), no keydown handler |
| Command menu on Ctrl+K / Ctrl+Shift+P, covering app-wide actions | Ctrl+K exists as a search/jump menu | `src/renderer-react/App.jsx:80` |
| Model picker on Ctrl+Shift+M, plus recent models on Ctrl+Ctrl+M | A model chip in the composer; no shortcut | `src/renderer-react/ActControls.jsx` |
| Find in chat on Ctrl+F, next/previous match on Ctrl+G | No in-thread find. Search is cross-chat only, but it does scan message text, which is the harder half | `src/renderer-react/SearchView.jsx:31` |
| Approving a tool asks for approval, Enter approves, Esc declines | Approvals exist with a 5 minute timeout, but only Esc is bound, and only to close the model chip | `src/main/providers/chat.js:207`, `src/renderer-react/ActControls.jsx:40-52` |
| If you type while a reply is streaming, a setting decides whether it steers the current run or waits for the next | Not modelled; a send during a reply is simply refused | `ChatPanel.jsx:912` (`|| replying`) |
| Dictation and voice chat, on Ctrl+Shift+V | Dictation exists and is browser speech recognition, no model in the path. No spoken replies | `ChatPanel.jsx:692`; `docs/voice-options.md` |
| A chat can be popped into its own window with Always on top | The overlay exists but is a launcher, not a second chat window | `src/main/tray-menu.js:49`, `OVERLAY_ACCELERATOR` |

The composer is the area where Zuri is closest. Stop works, the box auto-sizes,
attachments exist, and dictation is wired. What it lacks is the muscle memory:
ArrowUp, Ctrl+F in a long answer, and a keyboard path to the model picker.

---

## 2. Organising chats

Sources: `/docs/projects.md`, `/docs/reference/settings.md`.

ChatGPT's documented set, all from the projects and settings pages:

- Projects hold **Chats** and **Sources** (uploaded files and connected context),
  plus project instructions that apply to every chat inside. On the desktop app,
  a project can additionally be a **local folder** on disk, which the web project
  cannot be.
- **Pin** a project or a chat. Pinning changes position only, not context.
- **Rename** a chat to describe its outcome.
- **Search chats** from the sidebar by remembered phrase, with an assignable
  shortcut, because none is bound by default.
- **Archive** a chat, or archive all of a project's chats at once, and restore
  them from Settings > Archived chats.
- **Mark unread**, and clear unread markers with Shift+Esc.

| Capability | Zuri today | Evidence |
| --- | --- | --- |
| Project instructions carried into every chat | Yes, capped and normalised | `src/main/store.js:952-1003`, `normaliseProjectInstructions` |
| Projects hold chats, instructions and reference files | Built on the web: a project keeps one set of instructions and up to a few text files, and every chat filed inside it is answered with both. The desktop keeps projects and their instructions, but no project files | `server/src/app.js` (`projectContextMessage`, `readProjectContext`), `web/src/views/ProjectsView.jsx`, `server/test/projects.test.js` |
| File an existing chat into a project | Web, from the chat row menu; the current project is ticked and a chat can be taken back out | `web/src/views/ChatView.jsx` (`openProjectPicker`, `fileConversation`) |
| Pin a chat | Web only | `web/src/views/ChatView.jsx:1109` |
| Archive and restore | Web archives from the row menu; there is no archived screen to restore from yet. Absent on the desktop | `web/src/views/ChatView.jsx:1113` |
| Mark unread | Absent. Notifications are written with `read: false` and nothing ever flips it, so the count only grows | `src/main/store.js:2552`; grep `read: true` and `markRead`: nothing |
| Rename a chat | Web only | `web/src/views/ChatView.jsx` (`renamingId`, `saveRename`) |
| Group chats by date | Web: Today, Yesterday, Previous 7 days, Previous 30 days, Older | `web/src/views/ChatView.jsx:802` |
| Search by message text | Yes on desktop | `SearchView.jsx:31` (`findMatch` reads `thread.messages`) |

The unread finding is worth stating plainly: the store has a `read` flag whose
only value is `false`. Whatever shows an unread badge is counting a queue that
cannot be emptied.

---

## 3. The layers Zuri does not have at all

Sources: `/docs/customization/memories.md`, `/docs/automations.md`,
`/docs/reference/settings.md`.

**Memory.** ChatGPT turns eligible past chats into memories in the background,
waits until a chat is idle before summarising it, redacts secrets, and never
updates instantly. Users see and manage memories under Settings >
Personalization, can switch memory off, can control it per chat with a
`/memories` command, and can choose whether chats that used tools may feed future
memories. Zuri has no equivalent: `grep -rniE "memor(y|ies)"` over `src/` returns
nothing but unrelated cache comments. Zuri does have one 2000 character standing
instructions box (`src/main/store.js:86`), which covers the "rules" half of the
job but not the "remembers what I told it last week" half.

**Per-chat instructions split in two.** ChatGPT separates "about you" from "how
to respond". Zuri has a single `customInstructions` field plus answer style
choices, so the personal facts and the tone rules share one budget.

**Temporary chat.** Documented as a shortcut (Ctrl+Shift+N) and as a chat that
leaves nothing behind. Absent in Zuri; nothing in the composer marks a thread as
unstored.

**Scheduled work, with run history.** ChatGPT lists active, paused and completed
scheduled tasks with recent runs, offers **Run now**, allows a task to be either
standalone or attached to a chat so it returns to the same context, and warns you
to test a prompt in a normal chat before scheduling it. Zuri's automations do run
and can now call the model (`src/main/scheduler.js:406`, `458`,
`options.runPrompt`), which is further than the older agent-CLI note claims, but
the review surface around them is thinner.

**Artifacts.** ChatGPT creates, previews and refines documents, presentations,
spreadsheets and PDFs in place. Zuri is genuinely strong here already: a result
side panel plus real docx, pptx and xlsx output.

---

## 4. What Zuri already has, so nobody rebuilds it

| Zuri capability | Where |
| --- | --- |
| Streaming with a working Stop | `src/main/providers/chat.js`, `ChatPanel.jsx` |
| Ask / Act / Autopilot with per-tool approval and a 5 minute timeout | `providers/chat.js:197`, `:207`, `tools/index.js` |
| Nine tools: webSearch, webFetch, readFile, writeFile, createDocument, editDocument, summarizeDocument, openUrl, openApp | `tools/index.js:877-936` |
| Word, Excel and PowerPoint parsing and editing | `tools/index.js:49`, `office.js`, `office-edit.js` |
| Cross-chat search over message text | `SearchView.jsx:31` |
| Dictation | `ChatPanel.jsx:692` |
| Projects with instructions, skills, agents, automations, reminders | `store.js`, `scheduler.js`, `reminders.js` |
| Draft survives navigation | Web only, `web/src/lib/drafts.js`, `ChatView.jsx:281` |
| Edit and resend, copy, share (falls back to copy) | Web only, `ChatView.jsx:956-983` |
| Global hotkey overlay | `OVERLAY_ACCELERATOR = 'CommandOrControl+Alt+Space'` |

Two asymmetries inside Zuri itself are worth naming: the **web chat can edit a
message and resend it, the desktop cannot** (grep `editMessage` / "Edit and send"
in `ChatPanel.jsx`: nothing), and the **web chat keeps your draft, the desktop
loses it** (`draft` is `useState('')` at `ChatPanel.jsx:304` with no store write).

---

## 5. Ranked gap list

Sized by what it touches, not by how it feels.

### Do first: small, and felt every day

1. **Mark notifications read.** Add the write that clears `read`, and clear the
   badge. The flag already exists. `store.js:2552`.
2. **Enter approves and Esc declines an approval.** Matches ChatGPT's documented
   pair and removes a mouse trip from the one flow where people are waiting.
3. **ArrowUp restores the previous prompt** when the composer is empty.
4. **Remember the desktop draft** across navigation, copying the web's approach
   so both halves behave the same.
5. **Edit and resend on the desktop**, since the web chat already has it.

### Do next: smaller than they sound

6. **Pin, archive, mark unread, and date groups** in both sidebars. Pure store
   fields plus list rendering; no protocol work.
7. **Branching regenerate.** Instead of `removeTrailingReply` deleting the tail,
   keep the alternatives on the message and let the arrows switch. Zuri already
   tracks `droppedCloudIds` for sync, so the accounting habit is in place.
8. **Temporary chat** that writes no history and is excluded from cloud sync.
9. **Ctrl+F inside a thread**, with next and previous match.
10. **Per-site permission memory** for `openUrl` and `webFetch`: approve once,
    always allow for that host, or block it. This mirrors ChatGPT's Browser
    agent permissions without its browser.
11. **Follow-up behaviour while streaming**: steer the current run, or queue.

### Do later: real projects

12. **A memory layer.** Extraction after a chat goes idle, a settings list to
    read and delete entries, a per-chat switch, and injection on send. Secret
    redaction before storing. This is the biggest single win and the one that
    needs the most care, because a memory store is a privacy surface.
13. **Split custom instructions** into "about you" and "how to respond".
14. **Export**: one conversation as markdown, and everything as a JSON bundle.
15. **Read aloud** for a reply. `speechSynthesis` appears nowhere in either app,
    so this is new, not a repair.
16. **Scheduled task run history** with Run now, modelled on ChatGPT's Scheduled
    view.

---

## 6. What not to copy

- **Pets, dots, Appshots, Computer History.** Personality and passive capture.
  Computer History in particular is an always-on activity recorder; it is the
  opposite of what a local assistant should promise.
- **Cloud sandboxes, worktrees, subagent pools.** That is the coding-agent
  product, already covered in the other note, and heavier than Zuri's purpose.
- **Enterprise administration**, SCIM, gateways, compliance APIs. Not this
  product, at this size.
- **Event-triggered tasks on Gmail, Slack and GitHub.** Each is an OAuth
  integration with its own review burden. Zuri's value is local, and reminders
  plus schedules already cover most of the intent.

## 7. Not confirmed, do not quote as fact

- How ChatGPT's regenerate presents alternatives (arrow switching) is widely
  described but was not in the pages I read. I did confirm the *commands* for
  archive, pin, unread, find and temporary chat.
- The exact injection mechanics of memories into a request, and the retention
  period on the server side.
- Public share links for a conversation: I confirmed Zuri's share button, not
  ChatGPT's link semantics.
- Realtime voice mode and deep research behaviour beyond their existence.
- Whether scheduled tasks can be created from the Zuri overlay; I only confirmed
  they exist and can call the model.
