/**
 * providers/chat.js - the one place Zuri talks to an AI provider for a chat reply.
 *
 * A reply is a request/response with streaming: take the stored thread's messages,
 * ask the provider, push each token out as it arrives, run any tools the model asks
 * for (Ask, Act and Autopilot decide which ones and which need a yes), and append
 * the finished reply to the thread once the stream closes. Nothing outside
 * this module knows which provider answered, so switching provider is a settings
 * change rather than a code change.
 *
 * The provider call is plain HTTP over Node's built-in `fetch` (bundled with
 * Electron's Node) with a small server-sent-events reader, rather than the
 * `openai` / `@anthropic-ai/sdk` packages. That keeps the adapter to one streaming
 * code path for both providers and adds no dependency; the wire format is stable
 * and documented, and the installer stays light for the same reason decisions.md
 * gives for skipping a headless browser.
 *
 * The API key never leaves this process and never enters an error message: provider
 * failures are reduced to a short, redacted sentence before they go near the
 * renderer.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_PROVIDER, PROVIDERS, getKey } from '../secrets.js';
import { replyThroughAccount } from './cloud-chat.js';
import { appendMessage, findAgent, readStore, removeTrailingReply } from '../store.js';
import { agentAllowedTools, runTool, TOOLS } from '../tools/index.js';

/**
 * Tools the model may call on its own in chat, only when the person has switched web
 * search on for the message. Each call costs another provider request, so the default
 * is no web tools. The confirmation-gated tools are in GATED_TOOLS below.
 */
const CHAT_TOOLS = Object.freeze([
  {
    name: 'webSearch',
    description: 'Search the web. Use for current events, facts you are unsure of, or anything after your training data.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'webFetch',
    description: 'Read one web page by URL and return its text. Use after webSearch to read a result.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Full http or https URL.' } },
      required: ['url'],
    },
  },
]);

/**
 * Offered on every message (not only with web search on) because it costs nothing
 * unless the person asks for a file, and it only ever adds a new file to the workspace.
 */
const DOCUMENT_TOOL = Object.freeze({
  name: 'createDocument',
  description:
    'Create a downloadable Word (docx), Excel (xlsx) or PowerPoint (pptx) file when the person asks for a document, spreadsheet, deck or slides. ' +
    'Write the full content into the call; never ask them to copy text into Office themselves. After it succeeds, tell them the file is ready in one short sentence.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['docx', 'xlsx', 'pptx'], description: 'docx = Word, xlsx = Excel, pptx = PowerPoint.' },
      fileName: { type: 'string', description: 'Short file name without extension.' },
      content: {
        type: 'object',
        description:
          'docx: { title, sections: [{ heading, paragraphs: [text], bullets: [text], table: { rows: [[cell]] } }] }. ' +
          'xlsx: { sheets: [{ name, columns: [header], rows: [[value]] }] }; numbers stay numbers and a text value starting with "=" is a formula such as "=SUM(B2:B9)". ' +
          'pptx: { title, subtitle, slides: [{ title, bullets: [text], notes }] }.',
      },
    },
    required: ['kind', 'content'],
  },
});

const EDIT_TOOL = Object.freeze({
  name: 'editDocument',
  description:
    'Change an attached Word, Excel or PowerPoint file. Pass the file path shown after "Attached file" and a list of edits; the result is a new copy and the original stays untouched. ' +
    'docx/pptx edits: { find, replace } with the exact existing text. xlsx edits: { sheet, cell, value } (a value starting with "=" is a formula), { sheet, appendRow: [values] } or { find, replace }. ' +
    'Only use it when the person asks to change the file; otherwise just answer.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The attached file path.' },
      edits: { type: 'array', items: { type: 'object' }, description: 'The changes to make, in order.' },
    },
    required: ['path', 'edits'],
  },
});

/**
 * Reading tools. Offered on every message, not only when web search is switched on,
 * because they change nothing: an attachment is already inlined into the message, but
 * the model may still want to open another workspace file, or have a long attachment
 * summarised properly instead of guessing from the truncated inline copy.
 */
const READ_TOOL = Object.freeze({
  name: 'readFile',
  description:
    'Read a file from the Zuri workspace, or the text inside a .docx, .xlsx or .pptx file, by its path. ' +
    'Use it when the person names a file, or after an "Attached file" line whose inline copy was cut short.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path inside the workspace, or the attached file path.' },
    },
    required: ['path'],
  },
});

const SUMMARY_TOOL = Object.freeze({
  name: 'summarizeDocument',
  description:
    'Read a document and return a summary of it, written by the AI provider. Use it for a long document the person wants ' +
    'condensed; for a short file, readFile is enough and costs less.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the document to summarise.' },
      instruction: { type: 'string', description: 'What the summary should focus on, when they asked for something specific.' },
    },
    required: ['path'],
  },
});

const WRITE_TOOL = Object.freeze({
  name: 'writeFile',
  description:
    'Save text or Markdown as a file inside the Zuri workspace folder. It replaces a file of the same name, so the person is asked first. ' +
    'Use it only when they asked you to save or write something to a file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path inside the workspace, such as notes/plan.md.' },
      content: { type: 'string', description: 'The full text to save.' },
    },
    required: ['path', 'content'],
  },
});

const OPEN_URL_TOOL = Object.freeze({
  name: 'openUrl',
  description: 'Open a link in the default browser. Only links on the allow-list in Settings are accepted. Use it only when the person asks you to open something.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Full http or https URL.' } },
    required: ['url'],
  },
});

const OPEN_APP_TOOL = Object.freeze({
  name: 'openApp',
  description: 'Start an application. Only app names on the allow-list in Settings are accepted. Use it only when the person asks you to open an app.',
  parameters: {
    type: 'object',
    properties: { app: { type: 'string', description: 'The app name as it appears on the allow-list.' } },
    required: ['app'],
  },
});

/** Tools that produce a downloadable file; each success becomes a card under the reply. */
const FILE_TOOLS = Object.freeze([DOCUMENT_TOOL, EDIT_TOOL]);
const FILE_TOOL_NAMES = new Set(FILE_TOOLS.map((tool) => tool.name));

/**
 * Offered in every mode: building new files and reading them change nothing that
 * already exists, so they need no approval.
 */
const BASE_TOOLS = Object.freeze([DOCUMENT_TOOL, READ_TOOL, SUMMARY_TOOL]);

/**
 * Tools that change or open something outside Zuri. They are only offered in Act and
 * Autopilot, and the tool registry refuses each one until it is confirmed.
 */
const GATED_TOOLS = Object.freeze([EDIT_TOOL, WRITE_TOOL, OPEN_URL_TOOL, OPEN_APP_TOOL]);

/** Every tool chat can run by name; which are offered on a given message is decided per send. */
const ALL_CHAT_TOOLS = Object.freeze([...CHAT_TOOLS, ...BASE_TOOLS]);

// Unattended automations in Ask or Autopilot may inspect information but must not
// create files: nobody is watching, so nothing can be approved at the time.
const READ_ONLY_AUTOMATION_TOOLS = new Set(['webSearch', 'webFetch', 'readFile', 'summarizeDocument']);

/**
 * The three ways a message can be sent. Ask answers and reads, Act may also change
 * things once the person approves each step, and Autopilot skips the question for
 * the steps whose damage is already limited.
 */
export const CHAT_MODES = Object.freeze(['ask', 'act', 'autopilot']);

/**
 * Autopilot only skips approval for steps that cannot destroy anything: an edit is
 * written to a new copy, and a link or app has to be on the person's own allow-list
 * in Settings. writeFile replaces a file, so it always asks, whatever the mode.
 */
const AUTOPILOT_AUTO_APPROVED = new Set(['editDocument', 'openUrl', 'openApp']);

/** How long a step waits for an answer before it counts as a no. */
export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

/**
 * @param {unknown} value
 * @returns {'ask'|'act'|'autopilot'} Anything unknown is Ask, the mode that changes nothing.
 */
export function normaliseChatMode(value) {
  return CHAT_MODES.includes(value) ? value : 'ask';
}

/**
 * The tools one message may offer. Ask is the old behaviour minus the edit tool,
 * which could never run there because nothing asked for its approval.
 * @param {string} mode
 * @param {boolean} webSearch Whether the person switched web search on for this message.
 * @returns {object[]}
 */
export function toolsForMode(mode, webSearch) {
  const base = webSearch === true ? ALL_CHAT_TOOLS : BASE_TOOLS;
  return normaliseChatMode(mode) === 'ask' ? [...base] : [...base, ...GATED_TOOLS];
}

/**
 * One plain sentence for the approval card, so the person knows what they are
 * allowing without reading the raw arguments.
 * @param {string} name
 * @param {Record<string, any>} args
 * @returns {string}
 */
export function describeToolCall(name, args) {
  const target = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 120) : fallback);
  switch (name) {
    case 'editDocument':
      return `Edit a copy of ${path.basename(target(args?.path, 'your file'))} (the original stays as it is)`;
    case 'writeFile':
      return `Save ${target(args?.path, 'a file')} in your workspace, replacing it if it already exists`;
    case 'openUrl':
      return `Open ${target(args?.url, 'a link')} in your browser`;
    case 'openApp':
      return `Start ${target(args?.app, 'an app')}`;
    default:
      return `Run ${name}`;
  }
}

/**
 * Decide whether a tool call may run now.
 *
 * Tools that change nothing run straight away. A gated tool needs a yes: Autopilot
 * gives that yes for the limited-damage steps, and every other case asks the person
 * through `requestApproval`. No way to ask means no, so a missing approver can never
 * turn into a silent yes.
 * @param {{ name: string, args: Record<string, any>, mode: string, requestApproval?: Function }} call
 * @returns {Promise<{ run: boolean, confirmed: boolean, reason?: string }>}
 */
export async function approveToolCall({ name, args, mode, requestApproval }) {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool?.requiresConfirmation) return { run: true, confirmed: false };

  const chosenMode = normaliseChatMode(mode);
  if (chosenMode === 'ask') return { run: false, confirmed: false, reason: `${name} is not available in Ask mode. Switch to Act to allow it.` };
  if (chosenMode === 'autopilot' && AUTOPILOT_AUTO_APPROVED.has(name)) return { run: true, confirmed: true };
  if (typeof requestApproval !== 'function') return { run: false, confirmed: false, reason: `${name} needs your approval, and this window cannot ask for it.` };

  const approved = await requestApproval({ name, summary: describeToolCall(name, args) });
  return approved === true
    ? { run: true, confirmed: true }
    : { run: false, confirmed: false, reason: 'The person did not approve this step. Do not retry it; say what you did instead.' };
}

/** What the model is told about its mode, so it does not promise what the mode forbids. */
const MODE_PROMPTS = Object.freeze({
  ask: '',
  act: 'You are in Act mode. You may use tools to change things for the person: edit a copy of a document, save a file, open a link or an app. The person is asked to approve each of those steps, so propose them plainly and do not retry a step that was declined.',
  autopilot: 'You are in Autopilot mode. You may use tools to edit a copy of a document and to open allowed links and apps without asking. Saving a file over an existing one still needs the person to approve it. Work through the task, then say what you did.',
});

/** Each extra round is another paid model call, so the loop is capped hard. */
const MAX_TOOL_ROUNDS = 4;

/** A tool result is trimmed before going back to the model to keep the extra call cheap. */
const TOOL_RESULT_LIMIT = 8_000;

/**
 * Channel main pushes token events on. It is a one-way push, not an `invoke`
 * channel, so it stays out of the CHANNELS list in preload.js.
 */
export const CHAT_STREAM_CHANNEL = 'chat:stream';

/** Longest a single reply may run before the request is abandoned. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Reply cap for providers that require one (Anthropic does; OpenAI defaults it). */
const MAX_REPLY_TOKENS = 8192;

/**
 * Longest document body sent for a summary. A 200k-character read is well inside
 * every current context window, but trimming here keeps the request sane and the
 * saved summary notes when only part of the file was read.
 */
const SUMMARY_TEXT_LIMIT = 120_000;

/** What a document summary must contain, so Files shows the same shape every time. */
const SUMMARY_SYSTEM_PROMPT = [
  'You summarize documents for a busy professional.',
  'Start with one sentence saying what the document is and why it matters.',
  'Then give 3 to 6 short bullet points of the key facts, decisions or figures.',
  'Then a short "Action items" list, or state that there are none.',
  'Quote concrete names, numbers and dates from the document; never invent details.',
  'Write in English by default. Use another language only when the extra instruction explicitly requests it.',
  'Answer in Markdown with no preamble.',
].join(' ');

/**
 * This policy is appended after stored and agent prompts so a custom agent can
 * shape the answer without accidentally making the API switch languages.
 * Another language is allowed only when the person explicitly asks for it.
 */
const RESPONSE_LANGUAGE_POLICY = [
  'Language policy:',
  'Respond in clear English by default.',
  'Use another language only when the user explicitly asks you to respond, translate, or continue in that language.',
  'Do not mix languages unless the user explicitly requests a bilingual answer or the original text must be quoted.',
  'Keep names, code, file names, and quoted source text unchanged when they are not English.',
].join(' ');

/* ---------------------------------------------------------------------------
   Answer style

   The person chooses a length, tone, explanation level and layout once in
   Settings. These rules turn that choice into instructions that sit after any
   agent prompt (which decides what to say) and before the language policy
   (which owns the language), so a custom agent cannot undo a saved choice by
   accident and the language rule always has the last word.
   ------------------------------------------------------------------------ */

const ANSWER_LENGTH_RULES = Object.freeze({
  concise: 'Length: as short as the question allows. Answer in one or two sentences, then at most three short bullets, and leave out background nobody asked for.',
  balanced: 'Length: complete but not padded. The direct answer first, then the reasoning, the key steps or an example, and any caveat that changes what the person should do. Greetings and simple factual questions still get a short reply.',
  detailed: 'Length: thorough. The direct answer first, then the reasoning, steps, caveats, alternatives and worked examples that support it. Use headings once the answer has more than three sections.',
});

const ANSWER_TONE_RULES = Object.freeze({
  neutral: 'Tone: neutral and plain. No filler praise, no exclamation marks, no apology for replying.',
  professional: 'Tone: professional. Precise and courteous, with no slang and no filler.',
  friendly: 'Tone: warm and conversational, while staying accurate and no longer than the length rule allows.',
  direct: 'Tone: direct. State the answer and any recommendation plainly, say what you would do, and do not hedge.',
});

const ANSWER_DETAIL_RULES = Object.freeze({
  simple: 'Explanation level: plain words for a non-specialist. Define a technical term the first time it is needed and use a common word where one will do.',
  standard: 'Explanation level: an informed adult. Use ordinary technical words without stopping to define them.',
  expert: 'Explanation level: an expert reader. Use precise technical terms, skip the basics, and include numbers, edge cases and trade-offs.',
});

const ANSWER_LAYOUT_RULES = Object.freeze({
  auto: 'Layout: choose what fits the answer. No headings or lists in a short reply; bullets for separate facts; numbered steps for a procedure; a table only for a real comparison of the same attributes across two or more things; a fenced code block with a language tag for code.',
  plain: 'Layout: plain prose only. No headings, bullets, numbered lists, tables or code blocks unless the person explicitly asks for one.',
  structured: 'Layout: structure every answer. A one-line summary first, then short headings or bullets, and a table whenever two or more things are compared.',
});

/** Thinking rules that hold whatever length was chosen; brevity must not cost correctness. */
const ANSWER_QUALITY_POLICY = [
  'Quality:',
  'Work out the answer step by step before you write it, and check any figures, code or claims once before sending.',
  'Answer what the person is really trying to achieve, not only the literal words, and mention a better approach when you see one.',
  'If the request is ambiguous in a way that changes the answer, state your assumption or ask one short question.',
  'Give concrete examples, exact commands or working code rather than general advice. Never invent facts, names, links or quotes.',
].join(' ');

/** Formatting rules that hold whatever layout was chosen. */
const ANSWER_FORMAT_POLICY = [
  'Answer shape:',
  'Start with the answer itself, never with a restatement of the question or a preamble such as "Great question".',
  'Markdown is rendered: headings, bold, italics, links, bullet and numbered lists, tables, inline code and fenced code blocks all display.',
  'Never wrap a whole answer in a code fence, and never use decorative unicode or emoji.',
  'A table has to earn its place: the same attributes, one row per item. Do not use one for two lines of text or put prose in a cell.',
  'Say plainly when you do not know, and keep a link next to the claim it supports.',
].join(' ');

/**
 * Turn the saved answer-style choices into one instruction block.
 *
 * A missing or unknown value falls back to the default instead of throwing: a
 * settings file written by an older build, or one edited by hand, must still
 * produce a sensible reply rather than no reply at all.
 * @param {object} [settings] The settings object, as read from settings.json.
 * @returns {string}
 */
export function answerStylePolicy(settings = {}) {
  const pick = (value, rules, fallback) => (typeof value === 'string' && Object.hasOwn(rules, value) ? rules[value] : rules[fallback]);
  const parts = [
    'How to write this reply:',
    pick(settings?.answerLength, ANSWER_LENGTH_RULES, 'balanced'),
    pick(settings?.answerTone, ANSWER_TONE_RULES, 'neutral'),
    pick(settings?.answerDetail, ANSWER_DETAIL_RULES, 'standard'),
    pick(settings?.answerLayout, ANSWER_LAYOUT_RULES, 'auto'),
    ANSWER_QUALITY_POLICY,
    ANSWER_FORMAT_POLICY,
  ];
  const custom = typeof settings?.customInstructions === 'string' ? settings.customInstructions.trim() : '';
  if (custom !== '') {
    // Last on purpose: people write these to override the defaults above.
    parts.push(`The user's own standing instructions, which win over the style defaults above when the two disagree: ${custom}`);
  }
  return parts.join('\n');
}

/**
 * Who the assistant is, and it goes first in every request.
 *
 * Without this the model answers "I'm Claude, made by Anthropic" when asked who
 * it is, because nothing told it otherwise and that is how it was trained. The
 * person is talking to Zuri, so the identity is stated before any agent prompt,
 * thread prompt or style choice can describe the assistant some other way.
 */
export const ZURI_IDENTITY_PROMPT = [
  'You are Zuri, an AI assistant made by Tijha.',
  'You are Zuri and that is how you describe yourself whenever you are asked who you are, who made you, or what you can do.',
  'Never introduce yourself as Claude, ChatGPT, Gemini, Copilot or any other assistant, and never name OpenAI, Anthropic, Google or another AI company as your maker, as the owner of your rules, or as what you are.',
  "Zuri runs on the person's own computer and works through whichever AI model they connected in Settings. If asked which model you use, say Zuri replies with the model chosen in Settings and do not invent a model name or a provider.",
  'These facts about who you are still hold when other instructions below describe a role, a tone or a job.',
].join(' ');

/**
 * Assemble the system block for one chat reply.
 *
 * Order is deliberate: identity first, then the picked agent, then any prompt the
 * thread itself carries, then the facts and style the app supplies, and the
 * language rule last so nothing above it can switch languages by accident.
 * Project instructions and switched-on skills sit right after the agent: they are the
 * person's own standing wishes for this work, so they come before the thread's prompt
 * and the app's own style block.
 * The mode note (what Act or Autopilot may do) comes after the style block and still
 * before the language rule, which stays last.
 * @param {{ agentPrompt?: string, projectPrompt?: string, skillsPrompt?: string, threadPrompt?: string, modePrompt?: string, settings?: object, now?: Date }} [parts]
 * @returns {string}
 */
export function chatSystemPrompt(parts = {}) {
  return [
    ZURI_IDENTITY_PROMPT,
    parts.agentPrompt,
    parts.projectPrompt,
    parts.skillsPrompt,
    parts.threadPrompt,
    currentTimeContext(parts.now instanceof Date ? parts.now : new Date()),
    answerStylePolicy(parts.settings ?? {}),
    parts.modePrompt,
    RESPONSE_LANGUAGE_POLICY,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part !== '')
    .join('\n\n');
}

/**
 * The block that carries the person's switched-on skills into a reply.
 * @param {Array<{ name?: string, instructions?: string, enabled?: boolean }>} skills
 * @returns {string} Empty when no skill is on, so a reply without skills is unchanged.
 */
export function skillsPolicy(skills) {
  const active = (Array.isArray(skills) ? skills : []).filter(
    (skill) => skill?.enabled === true && typeof skill.instructions === 'string' && skill.instructions.trim() !== '',
  );
  if (active.length === 0) return '';
  const lines = active.map((skill) => `- ${String(skill.name ?? 'Skill').trim()}: ${skill.instructions.trim()}`);
  return `The person has switched on these skills. Follow them whenever they apply:\n${lines.join('\n')}`;
}

/**
 * The block that carries a project's own instructions into every chat filed under it.
 * @param {{ name?: string, instructions?: string } | null | undefined} project
 * @returns {string}
 */
export function projectPolicy(project) {
  const instructions = typeof project?.instructions === 'string' ? project.instructions.trim() : '';
  if (instructions === '') return '';
  return `This chat belongs to the project "${String(project.name ?? '').trim()}". Follow its instructions: ${instructions}`;
}

/** Provider error bodies are trimmed to this before they reach a bubble. */
const MAX_ERROR_DETAIL = 240;

/**
 * These models have no clock of their own, so without this they refuse questions
 * like "what day is it" even though the desktop knows. The date is read per
 * request rather than at module load so a long-running window stays correct.
 * @param {Date} [now]
 * @returns {string}
 */
function currentTimeContext(now = new Date()) {
  const date = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `Current local date and time where the user is: ${date}, ${time} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Use this whenever the user asks about today, the date, the day or the time. You still cannot see live websites or page contents unless a tool gives them to you.`;
}

/**
 * Everything that differs between providers. One entry per provider in
 * secrets.PROVIDERS, so a new provider is a table entry, plus a delta reader only
 * when the provider does not speak the OpenAI dialect.
 */
const PROVIDER_CONFIG = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    version: '2024-06-01',
    modelPattern: /^(gpt-|chatgpt-|o1|o3)/,
  }),
  anthropic: Object.freeze({
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-haiku-latest',
    version: '2023-06-01',
    modelPattern: /^claude-/,
  }),
  // DeepSeek, Kimi and GLM all speak the OpenAI chat-completions dialect, so each
  // needs no delta reader or request body of its own: requestBody, requestHeaders
  // and deltaText take the OpenAI branch for them, and a provider stays a table
  // entry. A reasoning model may also stream reasoning_content, which the reader
  // ignores, so thinking models work without a second code path.
  deepseek: Object.freeze({
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    // `deepseek-flash` is the current id and is served by DeepSeek-V4.1-Flash-1017.
    // The older `deepseek-chat` and `deepseek-reasoner` aliases were retired in July
    // 2026, so they must not be used as a fallback or a default.
    defaultModel: 'deepseek-flash',
    version: '2024-06-01',
    modelPattern: /^deepseek-/,
  }),
  moonshot: Object.freeze({
    label: 'Kimi',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    defaultModel: 'kimi-k3',
    version: '2024-06-01',
    modelPattern: /^kimi-/,
  }),
  zai: Object.freeze({
    label: 'Z.ai GLM',
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    defaultModel: 'glm-5.3',
    version: '2024-06-01',
    modelPattern: /^glm-/,
  }),
});

/**
 * Build the standard failure shape the store and secrets modules use, so the
 * renderer only ever branches on `ok`.
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Trim a provider's error text to something a person can act on. Applied to every
 * string that comes back from the network: a provider echoing part of the request
 * must not put a key in a log line or a chat bubble.
 * @param {unknown} value
 * @returns {string}
 */
function redact(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_DETAIL);
}

/**
 * Which provider and model a send should use.
 *
 * Order: the provider named in settings, then the first provider that actually has
 * a key, then the default. Falling back to a provider that has a key is what makes
 * a stored Anthropic key work without the user also having to name it.
 * A model is only reused when it belongs to the provider that won, so a model name
 * can never be sent to the wrong API.
 * @param {any} settings The store's settings object.
 * @returns {{ provider: 'openai'|'anthropic'|'deepseek'|'moonshot'|'zai', model: string }}
 */
export function resolveChatTarget(settings) {
  const configured = PROVIDERS.includes(settings?.provider) ? settings.provider : null;
  const provider = configured ?? PROVIDERS.find((name) => getKey(name) !== null) ?? DEFAULT_PROVIDER;

  // Ownership, not equality, decides this. Settings carry a model even when the
  // provider changed afterwards (the defaults hold gpt-4o), so trusting the saved
  // name would send gpt-4o to DeepSeek or Anthropic and fail a request the person
  // cannot fix from the error. A name that does not belong falls back instead.
  const savedModel = typeof settings?.model === 'string' ? settings.model.trim() : '';
  const model =
    savedModel !== '' && PROVIDER_CONFIG[provider].modelPattern.test(savedModel)
      ? savedModel
      : PROVIDER_CONFIG[provider].defaultModel;

  return { provider, model };
}

/**
 * Turn stored messages into the `{ role, content }` pairs both APIs accept.
 * Empty entries are dropped rather than sent: the store rejects empty content, but
 * a hand-edited chats.json could still carry one, and a provider would fail the
 * whole request over it.
 * @param {any[]} messages
 * @returns {{ system: string, turns: { role: string, content: string }[] }}
 */
function splitMessages(messages) {
  const system = [];
  const turns = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (content === '') continue;

    if (message.role === 'system') system.push(content);
    else {
      turns.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content,
        ...(Array.isArray(message.images) && message.images.length > 0 ? { images: message.images } : {}),
      });
    }
  }

  return { system: system.join('\n\n'), turns };
}

const IMAGE_MEDIA_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

/** Larger than this is refused by the providers or wastes a lot of tokens. */
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

/**
 * Replace each turn's saved image paths with the image parts its provider expects.
 * Only OpenAI and Anthropic models are known to read images; for the others the
 * images are left out and the model is told, so it does not pretend to see them.
 * The `images` key is always removed, because no provider accepts it on a message.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {{ role: string, content: string, images?: { name: string, path: string }[] }[]} turns
 * @returns {Promise<{ role: string, content: unknown }[]>}
 */
async function withImageParts(provider, turns) {
  const result = [];
  for (const { images, ...turn } of turns) {
    if (!Array.isArray(images) || images.length === 0) {
      result.push(turn);
      continue;
    }

    const parts = [];
    const skipped = [];
    for (const image of images) {
      const mediaType = IMAGE_MEDIA_TYPES[path.extname(image.path).toLowerCase()];
      const supported = provider === 'openai' || provider === 'anthropic';
      let bytes = null;
      if (supported && mediaType) {
        try {
          const info = await stat(image.path);
          if (info.size <= IMAGE_SIZE_LIMIT) bytes = await readFile(image.path);
        } catch (error) {
          console.warn('[zuri:chat] image', error?.message ?? error);
        }
      }
      if (bytes === null) {
        skipped.push(image.name || path.basename(image.path));
        continue;
      }
      const data = bytes.toString('base64');
      parts.push(
        provider === 'anthropic'
          ? { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
          : { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
      );
    }

    const note = skipped.length > 0
      ? `\n\n(The image ${skipped.join(', ')} could not be shown to you: this model cannot read images, or the file is missing or over 5 MB. Say so if it matters.)`
      : '';
    result.push({ ...turn, content: [...parts, { type: 'text', text: `${turn.content}${note}` }] });
  }
  return result;
}

/**
 * Request body per provider. Kept together so a second provider's shape sits
 * next to the first rather than in a second code path.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {string} model
 * @param {{ system: string, turns: { role: string, content: string }[] }} conversation
 * @returns {Record<string, unknown>}
 */
function requestBody(provider, model, conversation, tools = []) {
  if (provider === 'anthropic') {
    return {
      model,
      max_tokens: MAX_REPLY_TOKENS,
      stream: true,
      // Anthropic takes the system prompt as its own field, not as a message.
      ...(conversation.system ? { system: conversation.system } : {}),
      messages: conversation.turns,
      // Same tool list, different shape: Anthropic names the schema `input_schema`
      // and keeps the three fields flat, where OpenAI nests them under `function`.
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    };
  }

  return {
    model,
    stream: true,
    messages: [
      ...(conversation.system ? [{ role: 'system', content: conversation.system }] : []),
      ...conversation.turns,
    ],
    ...(tools.length > 0
      ? { tools: tools.map((tool) => ({ type: 'function', function: tool })) }
      : {}),
  };
}

/**
 * Auth headers per provider. The key is written here and nowhere else.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {string} key
 * @returns {Record<string, string>}
 */
function requestHeaders(provider, key) {
  if (provider === 'anthropic') {
    return {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': key,
      'anthropic-version': PROVIDER_CONFIG.anthropic.version,
    };
  }

  return {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${key}`,
  };
}

/**
 * The text in one streamed event, or '' when the event carries none.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {any} event Parsed JSON from one `data:` line.
 * @returns {string}
 */
function deltaText(provider, event) {
  if (!event || typeof event !== 'object') return '';

  if (provider === 'anthropic') {
    if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
      return event.delta.text;
    }
    return '';
  }

  const choice = Array.isArray(event.choices) ? event.choices[0] : null;
  return typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
}

/**
 * An error the provider reported inside the stream itself. Both APIs can send one
 * after a 200 response, so the stream reader has to look for it.
 * @param {any} event
 * @returns {string} The provider's message, or '' when the event is not an error.
 */
function streamedError(event) {
  if (event?.type === 'error') return redact(event.error?.message ?? event.message);
  if (event?.error) return redact(event.error.message ?? event.error);
  return '';
}

/**
 * Read a server-sent-events response and hand each data payload to `onEvent`.
 * SSE frames are separated by a blank line; a chunk boundary can fall anywhere,
 * so the incomplete tail is carried into the next read.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: any) => void} onEvent
 * @returns {Promise<void>}
 */
async function readEventStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice('data:'.length).trim();
          if (payload === '' || payload === '[DONE]') continue;
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // A provider may send a keep-alive that is not JSON. Ignoring it is
            // correct: the reply text is in the frames that do parse.
          }
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    // Release the socket even when the caller threw part-way through.
    reader.releaseLock();
  }
}

// DeepSeek sometimes writes its tool request into the reply text as DSML markup
// (`<｜DSML｜function_calls>...`) instead of a real tool_calls field. Left alone it
// would show up in the chat, so the markup is cut from the text and read as calls.
const DSML_START = /<[|｜\s]*DSML/;
const DSML_HOLD_BACK = 16;

/**
 * Split reply text into what the person should read and any DSML tool calls.
 * @param {string} text
 * @returns {{ visible: string, calls: { id: string, name: string, arguments: string }[] }}
 */
export function splitDsml(text) {
  const start = text.search(DSML_START);
  if (start === -1) return { visible: text, calls: [] };

  const calls = [];
  const chunks = text.slice(start).split(/invoke\s+name="/).slice(1);
  for (const chunk of chunks) {
    const name = chunk.slice(0, chunk.indexOf('"'));
    if (name === '') continue;
    const args = {};
    for (const match of chunk.matchAll(/parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\s*\/[^>]*?parameter\s*>/g)) {
      args[match[1]] = match[2].trim();
    }
    calls.push({ id: '', name, arguments: JSON.stringify(args) });
  }
  return { visible: text.slice(0, start).trimEnd(), calls };
}

/**
 * Send one conversation to the configured provider and collect the streamed reply.
 * This is the single request path: chat and document summaries both come through
 * it, so the provider's error mapping lives in one place.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {string} model
 * @param {string} key
 * @param {{ system: string, turns: { role: string, content: string }[] }} conversation
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, onDelta?: (text: string) => void }} [options]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: { code: string, message: string } }>}
 */
async function streamReply(provider, model, key, conversation, options = {}) {
  const config = PROVIDER_CONFIG[provider];
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  // Reaching this line takes a few milliseconds (the thread and the key are read
  // first), so Stop can land while the reply is still being prepared. Nothing is left
  // to ask for then: report the stop and send nothing. Guarding here also keeps the
  // request from going out with a signal that has already fired.
  if (options.signal?.aborted) {
    return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
  }

  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: requestHeaders(provider, key),
      body: JSON.stringify(requestBody(provider, model, conversation, options.tools ?? [])),
      // Stop and the request timeout are separate reasons to give up, so both drive
      // the same fetch: whichever fires first ends the request. AbortSignal.any keeps
      // the caller's signal from removing the timeout.
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A rejected fetch is a network problem (offline, DNS, proxy, timeout). It is
    // the one failure a person can retry, so it gets its own wording.
    if (error?.name === 'TimeoutError') {
      return failure('CHAT_TIMEOUT', `${config.label} did not answer in time. Try again.`);
    }
    // Stop aborts the request on purpose, so it must not read as a network fault.
    if (options.signal?.aborted) {
      return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
    }
    return failure(
      'CHAT_NETWORK_ERROR',
      `Could not reach ${config.label}. Check your connection and try again.`,
    );
  }

  if (!response.ok) {
    const detail = redact(await response.text().catch(() => ''));
    if (response.status === 401 || response.status === 403) {
      return failure(
        'CHAT_KEY_REJECTED',
        `${config.label} rejected the saved key. Update it in Settings.`,
      );
    }
    if (response.status === 429) {
      return failure(
        'CHAT_RATE_LIMITED',
        `${config.label} is rate limiting this key. Wait a moment and try again.`,
      );
    }
    return failure(
      'CHAT_PROVIDER_ERROR',
      `${config.label} returned ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  if (!response.body) {
    return failure('CHAT_PROVIDER_ERROR', `${config.label} returned no reply.`);
  }

  let reply = '';
  let streamedLength = 0;
  let reasoning = '';
  let streamedFailure = '';
  /** @type {{ id: string, name: string, arguments: string }[]} */
  const toolCalls = [];

  try {
    await readEventStream(response.body, (event) => {
      const problem = streamedError(event);
      if (problem !== '') {
        streamedFailure = problem;
        return;
      }

      // Anthropic announces a call with content_block_start and then streams its
      // arguments as input_json_delta pieces, keyed by the same content block index.
      if (provider === 'anthropic') {
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          toolCalls[event.index ?? 0] = {
            id: event.content_block.id ?? '',
            name: event.content_block.name ?? '',
            arguments: '',
          };
        } else if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          const slot = (toolCalls[event.index ?? 0] ??= { id: '', name: '', arguments: '' });
          slot.arguments += event.delta.partial_json ?? '';
        }
      }

      // OpenAI-style tool calls arrive in pieces keyed by index; the name comes
      // first, the JSON arguments are spread over later events.
      const delta = Array.isArray(event?.choices) ? event.choices[0]?.delta : null;
      if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content;
      for (const piece of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
        const slot = (toolCalls[piece.index ?? 0] ??= { id: '', name: '', arguments: '' });
        if (piece.id) slot.id = piece.id;
        if (piece.function?.name) slot.name += piece.function.name;
        if (typeof piece.function?.arguments === 'string') slot.arguments += piece.function.arguments;
      }

      const text = deltaText(provider, event);
      if (text === '') return;

      reply += text;
      if (typeof options.onDelta !== 'function') return;

      // Stream only what comes before any DSML markup, and hold back a trailing "<"
      // that might be the start of one split across two chunks.
      const marker = reply.search(DSML_START);
      let limit = marker;
      if (marker === -1) {
        const tail = reply.lastIndexOf('<');
        limit = tail !== -1 && reply.length - tail < DSML_HOLD_BACK ? tail : reply.length;
      }
      if (limit > streamedLength) {
        options.onDelta(reply.slice(streamedLength, limit));
        streamedLength = limit;
      }
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      return failure('CHAT_TIMEOUT', `${config.label} stopped responding. Try again.`);
    }
    // The person pressed Stop mid-stream: the partial answer is thrown away with it.
    if (options.signal?.aborted) {
      return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
    }
    return failure('CHAT_NETWORK_ERROR', `The reply from ${config.label} was cut off. Try again.`);
  }

  if (streamedFailure !== '') {
    return failure('CHAT_PROVIDER_ERROR', `${config.label} reported: ${streamedFailure}`);
  }

  const split = splitDsml(reply);
  // Markup calls only count when tools were offered; otherwise the model is asking for
  // something this turn cannot do, so the markup is dropped and the rest is shown.
  const offeredNames = (options.tools ?? []).map((tool) => tool.name);
  const calls = [
    ...toolCalls.filter((call) => call?.name),
    ...split.calls.filter((call) => offeredNames.includes(call.name)),
  ];
  if (split.visible.trim() === '' && calls.length === 0) {
    return failure('CHAT_EMPTY_REPLY', `${config.label} sent an empty reply. Try again.`);
  }

  // Whatever was held back (a trailing "<" that turned out to be plain text) goes out now.
  if (typeof options.onDelta === 'function' && split.visible.length > streamedLength) {
    options.onDelta(split.visible.slice(streamedLength));
  }

  return { ok: true, text: split.visible, reasoning, toolCalls: calls };
}

/**
 * Run the tool calls the model asked for and append the exchange to the conversation.
 * DeepSeek's thinking mode rejects the next request unless the assistant message that
 * made the calls carries its reasoning_content back, so it is kept here.
 */
async function answerToolCalls(
  conversation,
  reply,
  allowedTools,
  onStatus = () => {},
  offeredTools = ALL_CHAT_TOOLS,
  provider = 'openai',
) {
  /** Files built by createDocument in this round, handed back so the reply can carry them. */
  const files = [];
  /** Anthropic collects every result into one user turn; OpenAI wants one turn each. */
  const anthropicResults = [];
  const callId = (call, index) => call.id || (provider === 'anthropic' ? `toolu_${index}` : `call_${index}`);

  if (provider === 'anthropic') {
    // Anthropic wants the call and its result as typed blocks: tool_use in the
    // assistant turn, tool_result in the user turn that follows it.
    conversation.turns.push({
      role: 'assistant',
      content: [
        ...(reply.text ? [{ type: 'text', text: reply.text }] : []),
        ...reply.toolCalls.map((call, index) => ({
          type: 'tool_use',
          id: callId(call, index),
          name: call.name,
          input: parseToolInput(call.arguments),
        })),
      ],
    });
  } else {
    conversation.turns.push({
      role: 'assistant',
      content: reply.text,
      ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
      tool_calls: reply.toolCalls.map((call, index) => ({
        id: callId(call, index),
        type: 'function',
        function: { name: call.name, arguments: call.arguments || '{}' },
      })),
    });
  }

  for (const [index, call] of reply.toolCalls.entries()) {
    const args = parseToolInput(call.arguments);
    // Only the chat tool list is reachable; the model cannot name another tool.
    const offered = offeredTools.some((tool) => tool.name === call.name);
    if (offered) {
      if (call.name === 'createDocument') {
        onStatus(`Creating your ${String(args.kind ?? 'document').toLowerCase()} file`);
      } else if (call.name === 'editDocument') {
        onStatus('Editing a copy of your file');
      } else if (call.name === 'readFile') {
        onStatus(`Reading ${path.basename(String(args.path ?? args.file ?? 'your file')).slice(0, 80)}`);
      } else if (call.name === 'summarizeDocument') {
        onStatus('Summarising your document');
      } else {
        const target = String(args.query ?? args.url ?? '').slice(0, 80);
        onStatus(call.name === 'webFetch' ? `Reading ${target}` : `Searching the web for ${target}`);
      }
    }
    const result = offered
      ? await runTool(call.name, args, { allowedTools })
      : failure('TOOL_UNKNOWN', `${call.name} is not available in chat.`);
    const madeFile = FILE_TOOL_NAMES.has(call.name) && result.ok;
    if (madeFile) {
      const { path: filePath, name, kind, bytes } = result.data;
      files.push({ path: filePath, name, kind, bytes });
    }
    // The model only needs to know it worked; the full disk path is not useful to it.
    const outcome = JSON.stringify(
      madeFile
        ? {
            ok: true,
            data: {
              name: result.data.name,
              kind: result.data.kind,
              ...(result.data.changes !== undefined ? { changes: result.data.changes, notFound: result.data.notFound } : {}),
              note: 'The file is ready and shown to the person as a download card.',
            },
          }
        : result,
    ).slice(0, TOOL_RESULT_LIMIT);

    if (provider === 'anthropic') {
      anthropicResults.push({ type: 'tool_result', tool_use_id: callId(call, index), content: outcome });
    } else {
      conversation.turns.push({ role: 'tool', tool_call_id: callId(call, index), content: outcome });
    }
  }

  if (anthropicResults.length > 0) {
    conversation.turns.push({ role: 'user', content: anthropicResults });
  }
  return files;
}

/**
 * A tool call's arguments as an object. Both protocols stream them as JSON text,
 * and a malformed payload must not take the whole reply down: the tool then reports
 * its own missing-argument error, which the model can read and correct.
 * @param {string} [json]
 * @returns {Record<string, any>}
 */
function parseToolInput(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Summarize a document's text with the configured provider. Used by the
 * `summarizeDocument` tool through the injected `summarize` dependency, so the
 * tool layer never imports this module (that would be a cycle: this file selects
 * tools). Nothing is streamed to a chat: the summary is returned once, complete.
 * @param {{ text?: string, fileName?: string, instruction?: string }} [document]
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, data: { summary: string, provider: string, model: string, label: string, truncated: boolean } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function summarizeText(document = {}, options = {}) {
  const fullText = typeof document.text === 'string' ? document.text.trim() : '';
  if (fullText === '') {
    return failure('SUMMARY_EMPTY_DOCUMENT', 'There is no text in that document to summarize.');
  }

  const settings = await readStore('settings');
  if (!settings.ok) return settings;

  if (typeof options.cloudReply === 'function') {
    const name = typeof document.fileName === 'string' && document.fileName.trim() !== '' ? document.fileName.trim() : 'the document';
    const instruction = typeof document.instruction === 'string' ? document.instruction.trim() : '';
    const truncated = fullText.length > SUMMARY_TEXT_LIMIT;
    const body = truncated ? fullText.slice(0, SUMMARY_TEXT_LIMIT) : fullText;
    const prompt = [
      instruction === '' ? null : `Extra instruction from the person: ${instruction}`,
      `Document name: ${name}`,
      '',
      'Document text:',
      body,
    ].filter((line) => line !== null).join('\n');
    const reply = await options.cloudReply({
      conversation: { system: SUMMARY_SYSTEM_PROMPT, turns: [{ role: 'user', content: prompt }] },
      settings: settings.data,
      signal: options.signal,
      emit: options.emit,
      tools: [],
    });
    if (reply?.ok !== true) return reply ?? failure('SUMMARY_CLOUD_FAILED', 'Zuri could not summarize that document.');
    return {
      ok: true,
      data: {
        summary: String(reply.data?.content ?? '').trim(),
        provider: 'zuri-cloud',
        model: String(reply.data?.modelCode ?? 'zuri-flash'),
        label: String(reply.data?.modelName ?? reply.data?.modelCode ?? 'Zuri Cloud'),
        truncated,
      },
    };
  }

  const { provider, model } = resolveChatTarget(settings.data);
  const config = PROVIDER_CONFIG[provider];

  const key = getKey(provider);
  if (key === null) {
    return failure('CLOUD_AUTH_REQUIRED', 'Sign in to Zuri Cloud to summarize documents.');
  }

  const name = typeof document.fileName === 'string' && document.fileName.trim() !== '' ? document.fileName.trim() : 'the document';
  const instruction = typeof document.instruction === 'string' ? document.instruction.trim() : '';
  const truncated = fullText.length > SUMMARY_TEXT_LIMIT;
  const body = truncated ? fullText.slice(0, SUMMARY_TEXT_LIMIT) : fullText;

  const prompt = [
    instruction === '' ? null : `Extra instruction from the person: ${instruction}`,
    `Document name: ${name}`,
    '',
    'Document text:',
    body,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const reply = await streamReply(provider, model, key, {
    system: SUMMARY_SYSTEM_PROMPT,
    turns: [{ role: 'user', content: prompt }],
  }, options);
  if (!reply.ok) return reply;

  return {
    ok: true,
    data: {
      summary: reply.text.trim(),
      provider,
      model,
      label: `${config.label} ${model}`,
      truncated,
    },
  };
}

const WORD_ADDIN_SYSTEM_PROMPT =
  'You are Zuri, an AI assistant made by Tijha, working inside Microsoft Word, Excel or PowerPoint. Never call yourself Claude or name another assistant or AI company as your maker. ' +
  'Do what the person asks using the document text they give you. ' +
  'Reply with only the text to put in the document: no greeting, no explanation, no markdown fences.';

/** Longest slice of a document sent along with an add-in request; every character is billed. */
const ADDIN_CONTEXT_LIMIT = 30_000;

/**
 * One question from the Word add-in: an instruction plus the selected text or the
 * document, answered once with the configured provider. Not saved to any chat.
 * @param {{ prompt?: string, context?: string }} request
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, data: { text: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function askForAddin(request = {}, options = {}) {
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (prompt === '') return failure('ADDIN_EMPTY_PROMPT', 'Type what you want Zuri to do first.');

  const settings = await readStore('settings');
  if (!settings.ok) return settings;
  if (typeof options.cloudReply === 'function') {
    const context = typeof request.context === 'string' ? request.context.slice(0, ADDIN_CONTEXT_LIMIT) : '';
    const content = context === '' ? prompt : `${prompt}\n\nDocument text:\n${context}`;
    const reply = await options.cloudReply({
      conversation: { system: [WORD_ADDIN_SYSTEM_PROMPT, currentTimeContext()].join('\n\n'), turns: [{ role: 'user', content }] },
      settings: settings.data,
      signal: options.signal,
      emit: options.emit,
      tools: [],
    });
    if (reply?.ok !== true) return reply ?? failure('ADDIN_CLOUD_FAILED', 'Zuri could not answer that document request.');
    return { ok: true, data: { text: String(reply.data?.content ?? '').trim() } };
  }
  const { provider, model } = resolveChatTarget(settings.data);
  const key = getKey(provider);
  if (key === null) {
    return failure('CLOUD_AUTH_REQUIRED', 'Sign in to Zuri Cloud to use the Office add-in.');
  }

  const context = typeof request.context === 'string' ? request.context.slice(0, ADDIN_CONTEXT_LIMIT) : '';
  const content = context === '' ? prompt : `${prompt}\n\nDocument text:\n${context}`;
  const reply = await streamReply(provider, model, key, {
    system: [WORD_ADDIN_SYSTEM_PROMPT, currentTimeContext()].join('\n\n'),
    turns: [{ role: 'user', content }],
  }, options);
  if (!reply.ok) return reply;
  return { ok: true, data: { text: reply.text.trim() } };
}

/**
 * Ask the configured provider for a reply to `threadId` and stream it out.
 *
 * Tokens are pushed through `emit({ threadId, delta })` as they arrive; the final
 * event is `emit({ threadId, done: true })`, sent after the reply has been saved.
 * The resolved value carries the saved thread so the caller can repaint from the
 * store's copy rather than from what it streamed.
 *
 * @param {string} threadId
 * @param {{ emit?: (event: object) => void, fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 *   `emit` is the push channel; `fetchImpl` exists so the selftest can drive the
 *   stream against a fake without network access.
 * @returns {Promise<{ ok: true, data: { thread: any, message: any, provider: string, model: string } } | { ok: false, error: { code: string, message: string } }>}
 */
/**
 * The chat model a caller asked for, when it is one this app can actually send.
 *
 * The composer's model chip sends a catalogue pair, so the pair is checked here
 * rather than trusted. resolveChatTarget swaps an id that does not belong to its
 * provider for that provider's default, so a mismatched pair would make the window
 * say one Zuri model answered while another did. An unknown pair is ignored instead
 * of failing the reply, so a chip left over from an older catalogue never blocks a
 * chat.
 * @param {unknown} value
 * @returns {{ provider: 'openai'|'anthropic'|'deepseek'|'moonshot'|'zai', model: string } | null}
 */
function normaliseChosenModel(value) {
  if (value === null || typeof value !== 'object') return null;
  const provider = PROVIDERS.includes(value.provider) ? value.provider : null;
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  if (provider === null || model === '' || model.length > 64) return null;
  return PROVIDER_CONFIG[provider].modelPattern.test(model) ? { provider, model } : null;
}

export async function sendChatMessage(threadId, options = {}) {
  if (typeof threadId !== 'string' || threadId === '') {
    return failure('CHAT_INVALID_THREAD', 'A reply needs a chat to go in.');
  }

  const emit = typeof options.emit === 'function' ? options.emit : () => {};
  const mode = normaliseChatMode(options.mode);
  /** Files the tools build this turn; filled by the account loop and saved with the reply. */
  const builtFiles = [];

  // Regenerate writes the newest reply again: the old one goes first, so the model
  // answers the person's last message and not its own previous answer.
  if (options.regenerate === true) {
    const dropped = await removeTrailingReply(threadId);
    if (!dropped.ok) return dropped;
  }

  const listed = await readStore('chats');
  if (!listed.ok) return listed;

  const thread = listed.data.find((entry) => entry?.id === threadId);
  if (!thread) return failure('CHAT_NOT_FOUND', 'That chat no longer exists.');

  const conversation = splitMessages(thread.messages);
  if (conversation.turns.length === 0) {
    return failure('CHAT_EMPTY_THREAD', 'There is nothing in this chat to reply to yet.');
  }

  const settings = (await readStore('settings')).data;
  const agent = findAgent(settings, options.agentId);
  // A chat can pin its own model, and the composer's chip does exactly that. Every
  // model decision below reads `modelSettings`, so the cloud route, the direct route
  // and the reply saved at the end agree on which model answered.
  const chosenModel = normaliseChosenModel(options.model);
  const modelSettings = chosenModel === null
    ? settings
    : { ...settings, provider: chosenModel.provider, model: chosenModel.model };
  // An agent's own provider wins over Settings; its model then falls back to that
  // provider's default because the saved model belongs to the Settings provider.
  const agentProvider = agent !== null && PROVIDERS.includes(agent.provider) ? agent.provider : null;
  const { provider } = resolveChatTarget(
    agentProvider === null ? modelSettings : { ...modelSettings, provider: agentProvider },
  );
  conversation.turns = await withImageParts(provider, conversation.turns);

  // An agent's system prompt rides in front of any the thread already carries, so
  // the picked agent decides how the reply is written without losing the thread's
  // own. Zuri's identity is added inside chatSystemPrompt, ahead of both.
  // A project's instructions and the person's switched-on skills are read fresh for
  // every reply, so changing either takes effect on the very next message. A store
  // that cannot be read leaves the reply without them rather than failing it.
  const skillsStore = await readStore('skills');
  const projectsStore = await readStore('projects');
  const project = projectsStore.ok && typeof thread.projectId === 'string'
    ? projectsStore.data.find((entry) => entry?.id === thread.projectId) ?? null
    : null;

  conversation.system = chatSystemPrompt({
    agentPrompt: agent !== null ? agent.systemPrompt : '',
    projectPrompt: projectPolicy(project),
    skillsPrompt: skillsPolicy(skillsStore.ok ? skillsStore.data : []),
    threadPrompt: conversation.system,
    modePrompt: MODE_PROMPTS[mode],
    settings: modelSettings,
  });

  // Desktop chat must always use the signed-in account route. Keeping a direct
  // provider fallback here would let an older caller bypass Railway and revive the
  // local-key flow that the shipped installers no longer expose.
  if (typeof options.cloudReply !== 'function') {
    return failure('CLOUD_AUTH_REQUIRED', 'Sign in to Zuri to get replies. Open Zuri Cloud in the sidebar.');
  }

  // The account is the only way in. main.js hands in a cloudReply whenever the app
  // asks for a reply, so a chat is answered from the person's Zuri plan and no
  // supplier key is read, stored or needed.
  let reached;
  try {
    // The account route is a conversation of rounds now: the model may ask for a
    // tool, the app runs it, and the result goes back. The tools themselves always
    // run here, on this computer, because that is where the workspace is; the
    // server only ever forwards the definitions and returns the request.
    const allowedForAccount = agentAllowedTools(settings, options.agentId);
    const offeredForAccount = toolsForMode(mode, options.webSearch)
      .filter((tool) => allowedForAccount === null || allowedForAccount.includes(tool.name));

    // The wire conversation grows as rounds go by: an assistant turn that asked
    // for a tool, then one result per call.
    const wire = conversation.turns.map((turn) => ({ ...turn }));
    let rounds = 0;
    let textSoFar = '';
    for (;;) {
      const toolsForRound = rounds < MAX_TOOL_ROUNDS ? offeredForAccount : [];
      reached = await options.cloudReply({
        conversation: { system: conversation.system, turns: wire },
        settings: modelSettings,
        tools: toolsForRound,
        signal: options.signal,
        emit: (event) => {
          if (typeof event.delta === 'string') textSoFar += event.delta;
          emit({ threadId, ...event });
        },
      });
      if (!reached.ok) break;

      const calls = Array.isArray(reached.data?.toolCalls) ? reached.data.toolCalls : [];
      if (calls.length === 0 || toolsForRound.length === 0) break;

      // The call and its results have to travel with the next round, or the model
      // cannot see what it asked for or what came back.
      wire.push({ role: 'assistant', content: reached.data.content || '', toolCalls: calls });
      for (const call of calls) {
        const args = parseToolInput(call.arguments);
        const offered = offeredForAccount.some((tool) => tool.name === call.name);
        // The mode and the person decide whether a risky step runs; the registry
        // still refuses it unless `confirmed` is set, so this is the only way in.
        const decision = offered
          ? await approveToolCall({ name: call.name, args, mode, requestApproval: options.requestApproval })
          : null;
        let outcome;
        if (decision === null) outcome = failure('TOOL_UNKNOWN', `${call.name} is not available in chat.`);
        else if (decision.run) outcome = await runTool(call.name, args, { allowedTools: allowedForAccount, confirmed: decision.confirmed });
        else outcome = failure('TOOL_DECLINED', decision.reason);
        const madeFile = FILE_TOOL_NAMES.has(call.name) && outcome.ok;
        if (madeFile) {
          const { path: filePath, name, kind, bytes } = outcome.data;
          builtFiles.push({ path: filePath, name, kind, bytes });
          emit({ threadId, files: [{ path: filePath, name, kind, bytes }] });
        }
        emit({ threadId, status: madeFile ? `Made ${outcome.data.name}` : '' });
        wire.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(madeFile
            ? { ok: true, data: { name: outcome.data.name, kind: outcome.data.kind, note: 'The file is ready and shown to the person as a download card.' } }
            : outcome,
          ).slice(0, TOOL_RESULT_LIMIT),
        });
      }
      rounds += 1;
    }

    // The per-round tool files are already in builtFiles; the shared code below
    // saves one message from reached.data.content, so it is told the whole text.
    if (reached.ok) reached.data.content = textSoFar !== '' ? textSoFar : reached.data.content;
  } catch (error) {
    // Stop aborts the request under the stream, which surfaces as a failed read
    // rather than an answer. That is the person's own doing and must not appear
    // as a network fault, so it gets the same wording the direct route uses.
    if (options.signal?.aborted) return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
    if (error?.name === 'TimeoutError') return failure('CHAT_TIMEOUT', 'Zuri Cloud did not answer in time. Try again.');
    return failure('CHAT_NETWORK_ERROR', 'The reply from Zuri Cloud was cut off. Try again.');
  }
  // The stream stopped early or the server reported a failure; say so plainly.
  if (options.signal?.aborted) return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
  if (!reached.ok) return reached;
  const saved = await appendMessage(threadId, {
    role: 'assistant',
    content: reached.data.content,
    files: builtFiles,
    // Saved with the reply so the chip can name the model that answered, and so
    // reopening this chat sends the next message to the same one.
    model: { provider: modelSettings.provider, model: modelSettings.model },
  });
  if (!saved.ok) return saved;
  emit({ threadId, done: true });
  return {
    ok: true,
    data: { ...saved.data, provider: 'zuri-cloud', model: reached.data.modelCode },
  };
}

/**
 * Run one prompt through the same pipeline a chat message uses, with no thread and
 * nothing streamed: this is what an automation runs while the person is away.
 *
 * The loop is sendChatMessage's, and deliberately so. An automation used to be
 * reduced to a single web search or page fetch chosen by looking at its prompt, so
 * "summarise my invoices and tell me which are overdue" ran a search. Routing the
 * prompt here instead lets the model decide what it needs, in the order it needs it.
 *
 * @param {{ prompt?: string, agentId?: string|null, allowedTools?: string[]|null, mode?: 'ask'|'act'|'autopilot', signal?: AbortSignal, onStatus?: (status: string) => void }} [request]
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ ok: true, data: { text: string, provider: string, model: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function runPrompt(request = {}, options = {}) {
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (prompt === '') {
    return failure('CHAT_EMPTY_THREAD', 'This automation has no prompt to run.');
  }

  const settings = (await readStore('settings')).data;
  const agent = findAgent(settings, request.agentId ?? null);
  const agentProvider = agent !== null && PROVIDERS.includes(agent.provider) ? agent.provider : null;
  const { provider, model } = resolveChatTarget(
    agentProvider === null ? settings : { ...settings, provider: agentProvider },
  );
  const config = PROVIDER_CONFIG[provider];

  if (typeof options.cloudReply === 'function') {
    const reply = await options.cloudReply({
      conversation: {
        system: chatSystemPrompt({ agentPrompt: agent !== null ? agent.systemPrompt : '', settings }),
        turns: [{ role: 'user', content: prompt }],
      },
      settings,
      signal: request.signal,
      emit: (event) => request.onStatus?.(event?.status ?? ''),
      tools: [],
    });
    if (reply?.ok !== true) return reply ?? failure('CHAT_CLOUD_FAILED', 'Zuri could not run that automation.');
    const text = String(reply.data?.content ?? '').trim();
    if (text === '') return failure('CHAT_EMPTY_REPLY', 'Zuri sent an empty answer for this automation.');
    return { ok: true, data: { text, provider: 'zuri-cloud', model: String(reply.data?.modelCode ?? 'zuri-flash') } };
  }

  const key = getKey(provider);
  if (key === null) {
    return failure('CLOUD_AUTH_REQUIRED', 'Sign in to Zuri Cloud so automations can run.');
  }

  const conversation = {
    system: chatSystemPrompt({
      agentPrompt: agent !== null ? agent.systemPrompt : '',
      settings,
    }),
    turns: [{ role: 'user', content: prompt }],
  };

  // Confirmation-gated tools (writeFile, openUrl, openApp) are left out on purpose:
  // a run happens with nobody watching, and starting an app or opening a link then
  // is not something the person can agree to at the time.
  const allowed = Array.isArray(request.allowedTools) ? request.allowedTools : null;
  const mode = request.mode === 'act' || request.mode === 'autopilot' ? request.mode : request.mode === 'ask' ? 'ask' : null;
  const tools = ALL_CHAT_TOOLS.filter((tool) => {
    if (allowed !== null && !allowed.includes(tool.name)) return false;
    if ((mode === 'ask' || mode === 'autopilot') && !READ_ONLY_AUTOMATION_TOOLS.has(tool.name)) return false;
    return true;
  });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let fullText = '';
  let nudged = false;
  for (let round = 0; ; round += 1) {
    const toolsOffered = round < MAX_TOOL_ROUNDS ? tools : [];
    if (round > 0 && !nudged && (toolsOffered.length === 0 || conversation.needsAnswer === true)) {
      conversation.turns.push({ role: 'user', content: 'Answer now in plain text using the results above. Do not call any tools.' });
      nudged = true;
    }

    const reply = await streamReply(provider, model, key, conversation, {
      fetchImpl,
      signal: request.signal,
      tools: toolsOffered,
    });
    if (!reply.ok) {
      // A round that came back empty after tools ran is not worth losing the text.
      if (reply.error.code === 'CHAT_EMPTY_REPLY' && round > 0 && fullText.trim() !== '') break;
      return reply;
    }

    if (fullText !== '' && reply.text !== '') fullText += '\n\n';
    fullText += reply.text;
    if (reply.toolCalls.length === 0) break;
    await answerToolCalls(
      conversation,
      reply,
      allowed,
      (status) => request.onStatus?.(status),
      tools,
      provider,
    );
  }

  if (fullText.trim() === '') {
    return failure('CHAT_EMPTY_REPLY', `${config.label} sent an empty answer for this automation.`);
  }
  return { ok: true, data: { text: fullText.trim(), provider, model } };
}
