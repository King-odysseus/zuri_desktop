# Zuri Desktop vs Claude Code, Codex and Kimi Code

A gap analysis of where Zuri is today, what the three reference agent tools do
that Zuri does not, and the order worth doing things in. Every "Zuri today"
claim below was checked in the code, not remembered; the comparison notes come
from the vendors' own documentation and release notes (October 2026).

---

## 0. What has been fixed since this was written

Three items below are done. The "Zuri today" table in section 1 describes the
state *before* them, and is kept so the reasoning that led here stays readable.
Each fix is covered by a self-test check that drives the real code with a fake
provider stream, so none of it depends on a network or a key.

| Item | What changed | Where |
| --- | --- | --- |
| 1. Anthropic tools | The tool list is translated into Anthropic's shape: `input_schema` going out, `tool_use` blocks read from the stream, `tool_result` blocks sent back. Claude models can now search, read and build documents. | `src/main/providers/chat.js` |
| 2. Read-only tools in chat | `readFile` and `summarizeDocument` are offered on every message, not only with web search switched on, and need no approval because they change nothing. | `src/main/providers/chat.js` |
| 3. Automations run the model | A schedule with no declared steps sends its prompt through the chat pipeline with its own `allowedTools`, and the answer is written into the run result under a new "Answer" heading. A caller with no model available (the offline demo) still falls back to the old single-call plan. | `src/main/scheduler.js`, `src/main/main.js` |

Still open from Tier 1: the other half of item 2 (the approval prompt, which is
what unlocks `writeFile`, `openUrl` and `openApp`) and item 4, long-term memory.

---

## 1. Where Zuri stands today (verified)

| Area | What the code actually does | File |
| --- | --- | --- |
| Providers | Five: openai, anthropic, deepseek, moonshot, zai. Keys stored locally, file mode 0600. | `src/main/secrets.js:29` |
| Tool calling | Real. `MAX_TOOL_ROUNDS = 4`, results trimmed to 8000 chars, DeepSeek DSML-style markup calls parsed as a fallback. | `src/main/providers/chat.js:104-110`, `:779` |
| Tools offered in chat | 2 of the 9 registered by default (`createDocument`, `editDocument`), or 4 when web search is switched on (adds `webSearch`, `webFetch`). | `src/main/providers/chat.js:36-104` |
| Tools on Anthropic | **None.** The tool list is emptied for the Anthropic path, and no Anthropic tool format is ever built, so Claude models cannot search, fetch or build a document. **Fixed - see section 0.** | `src/main/providers/chat.js:1000-1007` |
| Tools never offered in chat | originally `readFile`, `writeFile`, `summarizeDocument`, `openUrl`, `openApp`. Two different reasons: `writeFile`, `openUrl` and `openApp` are `requiresConfirmation` and a streaming reply has no approval step; `readFile` and `summarizeDocument` were simply left out of the chat tool list. **The second pair is now offered (section 0); the confirmation-gated three still wait on the approval prompt.** | `src/main/tools/index.js:874-943`, `src/main/providers/chat.js:36-104` |
| Agent allow-lists | Enforced. `agentAllowedTools(settings, agentId)` filters the tool list per send. | `src/main/providers/chat.js:1002-1007` |
| Stop a reply | Wired end to end (`zuri:chat:stop`, `stopReply()` in the view). | `src/main/main.js:303`, `src/renderer-react/ChatPanel.jsx:333` |
| Standing instructions | One free-text field, 2000 chars, appended last in the style block. | `src/main/store.js:86`, `src/main/providers/chat.js:229` |
| Persisted state | chats, tasks, reminders, schedules, runs, notifications, settings. Nothing else. | `src/main/store.js:33` |
| Automations | **Do not call the model.** A plain link becomes one `webFetch`; anything else becomes one `webSearch`. | `src/main/scheduler.js:212-250` |
| Context management | None. No token estimate, no compaction, no trimming of chat history. | `src/main/providers/chat.js:369` |
| MCP | Absent. No reference anywhere in `src/main` or `src/renderer-react`. | - |
| Usage/cost shown | Not in chat. | `src/renderer-react/ChatPanel.jsx` |

So the good news is bigger than the older notes suggest: tool calling exists,
allow-lists are enforced, and stop works. The bad news is that the *agent loop
is deliberately hobbled* - four rounds, two to four tools, no approval UI - and there is
no memory layer at all. And a detail worth catching early: the provider that
speaks a different tool dialect (Anthropic) gets no tools whatsoever, so the
model family Zuri is most obviously compared against is the one that can do
least inside it.

---

## 2. What the three reference tools do that Zuri does not

### Claude Code

- **Hooks** on lifecycle events (before/after a tool call, session start, turn
  start) so a person can inject their own commands.
- **Subagents** - named child agents with their own prompt, tool set and model,
  delegated to for a slice of work and reported back.
- **Skills** - reusable markdown procedures the agent can pull in on demand.
- **Plugins** that bundle skills, agents, hooks and MCP servers.
- **MCP servers** as first-class tools.
- **Checkpoints / rewind** - roll the working tree back to an earlier turn.
- **Plan mode** - produce a reviewed plan before touching anything.
- **Permission modes** - ask every time, ask when needed, or don't ask.
- **Memory** - project instructions in a file that is read on every run.

### Codex (CLI and app)

- **OS-level sandbox** with three approval modes: read-only, workspace-write,
  danger-full-access. The sandbox is the boundary, not a prompt.
- **AGENTS.md** for per-project instructions.
- **Compaction** (`/compact`) and session resume, so long work survives.
- **Background/cloud tasks** that keep running when the laptop is closed.
- **Code review** as a first-class command.
- **Headless exec mode** for scripting.

### Kimi Code

- **Goal mode**: a long-running objective that can be paused, resumed and
  cancelled, with a time budget that ignores time the app was shut.
- **Plan mode**: the agent proposes a plan, the person reviews and comments.
- **Three permission modes** plus a built-in **dangerous command guard**
  (`rm -rf`, `shutdown`) that is refused even in fully automatic mode.
- **Workspace trust**: an untrusted folder cannot send messages, and file tools
  refuse symlinks that escape the workspace.
- **Subagent model pool**: each delegated task is routed to a cheap or strong
  model by fit.
- **Session fork and export**, plus auto-generated session titles.
- **Cache-expiry hints** and a context-size indicator - it warns before a long
  session gets expensive.
- **Progress narration** inside a turn, and background tasks the agent can wait
  on without ending the turn.
- **Remote control**: drive the local session from a phone by link or QR code.
- **Plugin marketplace**, hooks, skills, ACP for other clients.
- **Rich rendering**: Mermaid and LaTeX in the transcript, tool calls collapsed
  to a summary line.
- **Built-in browser with annotation** so the person can point at a page.

---

## 3. The gaps, ranked

Ranked by what removes the most friction per unit of work. The first five are
the ones that actually change what the product *is*, and the first is also the
smallest job on the page.

### Tier 1 - makes Zuri an agent instead of a chat box

**1. Tools for Anthropic, so Claude models stop being a plain chatbot.**
`chat.js:1000-1007` throws the tool list away when the provider is Anthropic and
the request builder has no Anthropic tool schema at all. The result is that
switching Zuri to a Claude model silently removes web search, page fetch and
document creation - a person would read that as "Claude is worse", not "the
adapter is incomplete". This is the cheapest high-value fix in the document:
`requestBody` already has an Anthropic branch (`chat.js:464`), and the delta
reader already handles that shape, so what is missing is a second translation
for tools (Anthropic wants `{name, description, input_schema}` and returns
`tool_use` blocks) plus mapping tool results back as `tool_result` content.
Roughly one focused afternoon, and it removes a whole class of "model X is
worse" confusion.

**2. Approval UI, so dangerous tools can be offered in chat.**
Today `writeFile`, `openUrl` and `openApp` are registered but unreachable from
chat purely because a streaming reply has nowhere to ask. Fix that and four
powers switch on at once. The registry already carries `requiresConfirmation`
(`src/main/tools/index.js:874`), so this is a renderer gate plus a promise in
main, not new plumbing: the tool loop pauses, the window shows "Zuri wants to
save a file in your workspace - Allow / Always / Deny", and the loop resumes.
Kimi's three modes are the right shape to copy, and `allowedApps` /
`allowedUrls` in settings already provide the persisted "Always" state.

Worth splitting out, because it is free: `readFile` and `summarizeDocument` need
no approval at all - they only read - yet they are also missing from the chat
tool list (`chat.js:36-104`). An attached file already lands in the message with
its path spelled out ("Attached file ..."), which is exactly what `readFile`
takes, so adding these two to `ALL_CHAT_TOOLS` is a one-line change that lets a
model open a workspace file it was not handed, or summarise a long attachment
instead of guessing from the truncated inline text. Do this first, then the
approval gate for the other three.

**3. Automations must run the model, not a heuristic.**
`scheduler.js:212-250` picks one tool from the prompt text. That means an
automation called "summarise my invoices and tell me which are overdue" runs a
web search. Route the prompt through the existing chat pipeline instead
(`runChat`/`sendChatMessage`) with the automation's `allowedTools`, cap the
rounds, and save the reply as the run result. The run file, the toast and the
runs page already exist and need no change - only the thing being run changes.
This is the single biggest functional gap: it is the difference between
"reminder that searches" and "assistant that works while you are away".

**4. Long-term memory.**
Zuri has one 2000-character instructions box. All three reference tools have a
memory file, and Kimi and Claude Code both let the agent *write* to it. Add a
`memory` store key (small markdown entries with a source and a date), inject the
relevant slice into the system prompt, and give the model a `rememberFact` tool
so it can save something a person tells it to remember. Without this, every
conversation restarts from zero, which is the most common complaint about
chat-wrapper products.

**5. Context management: a size indicator and compaction.**
`splitMessages` sends the whole thread every time. A long chat on a 1M-token
model is fine; on gpt-4o it fails, and on any model it costs money linearly.
Add a local token estimate per thread, show it in the composer, warn past a
threshold, and offer "compact" - which the app already has the machinery for
(`summarizeDocument` calls a model to produce a summary). Store the summary as
a single `system` message at the head of the thread. Kimi's cache-expiry hint is
the UX detail worth copying: warn *before* the expensive request.

### Tier 2 - depth that makes the agent competent

**6. Raise the loop budget and make it visible.** `MAX_TOOL_ROUNDS = 4` is very
low; a real research answer needs 8 to 12. Raise it per agent (a settings field)
and show "step 3 of 12" in the reply header, so a long run looks alive instead
of frozen.

**7. Skills.** Markdown files in the workspace with a name, a description and a
procedure, listed to the model in the system prompt and pulled in when relevant.
Cheap to build - it is a folder and a `readFile` - and it gives people a way to
teach Zuri *their* way of doing a recurring job without writing an automation.

**8. Subagents.** Once automations call the model, a run often needs three
searches and two file reads. A `delegate` tool that fans out to a child run with
its own tool subset and model, then returns one summary, keeps the main thread's
context clean. Route the child to a cheap model - Kimi's subagent model pool is
the pattern.

**9. MCP.** The whole ecosystem of tools (files, databases, ticketing, browsers)
is reachable through one protocol. Adding a client is a settings page listing
server commands plus a JSON-RPC pipe; each server's tools are merged into the
registry with a `mcp:<server>:<tool>` name so the existing allow-list and
confirmation gate apply unchanged.

**10. Checkpoints for file edits.** `editDocument` already saves a new copy
rather than overwriting (`src/main/providers/chat.js:86`), which is a good
safety property. Extend the same idea to `writeFile`: keep the previous version
and offer "revert" on the file card. Claude Code's rewind is this feature and
people lean on it constantly.

**11. Session fork, export and auto-titles.** Editing one message and branching
from there is a normal way to work; today a person has to start a fresh thread.
Export as Markdown is a few lines and makes the app trustworthy for real work.

### Tier 3 - polish that keeps people in the app

**12. Tool-call cards that collapse to one line.** Kimi collapses a finished
call to a title plus a result summary, expandable with Ctrl+O. Zuri streams
status text; making it a real card with the arguments, the result and the cost
reads far better on a long run.

**13. Usage and cost per reply.** A small footer with tokens in, tokens out and
an estimated cost, priced per model. It is the feature that makes people trust
a BYO-key app, because they can see what a habit costs.

**14. Remote control from a phone.** The web client and the Android build
already exist. A link or QR that reaches the running desktop session would make
the phone app actually worth installing - Kimi shipped exactly this in October
and it is the highest-value mobile feature available.

**15. Rich rendering.** Mermaid diagrams and LaTeX in replies, in
`FormattedMessage.jsx`. Cheap, and it changes what Zuri looks like next to the
competition.

---

## 4. What not to copy

- **Do not copy the coding-agent framing.** Zuri's audience is office work:
  documents, reminders, email-shaped tasks. Competing on `/review` and git
  branching would fight the product's own brief.
- **Do not ship a "fully automatic" mode first.** Kimi needed a dangerous
  command guard because that mode is genuinely risky. Zuri should start at
  "ask when needed" and let people opt upward, per tool.
- **Do not add a plugin marketplace.** It is a support burden and a supply-chain
  risk. Skills as plain markdown in a folder give 80 percent of the value with
  none of the review work.

---

## 5. Suggested order of work

1. Anthropic tool support, so every provider can actually act.
2. Approval UI + offer the three gated tools in chat.
3. Automations call the model with their own `allowedTools`.
4. Memory store, prompt injection and a `rememberFact` tool.
5. Token indicator, warning and compaction.
6. Raise the round cap, add step progress.
7. Skills folder.
8. Subagents with a cheap-model route.
9. MCP client.
10. File checkpoints and revert.
11. Fork, export, auto-titles.
12. Tool cards, cost footer, Mermaid/LaTeX.
13. Phone remote control.

Items 1 to 4 are what move Zuri from "a chat app with extras" to "an assistant
that does work while you are not looking", and item 1 is what stops a whole
provider from looking broken. Everything after that is depth.
