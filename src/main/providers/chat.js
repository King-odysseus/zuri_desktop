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
 * Asked of the model when a whole turn came back with no words in it.
 *
 * A model sometimes writes its tool request as text for a tool this turn never
 * offered. That markup is stripped, so nothing is left to show, and the turn ends
 * with no reply at all. One more round with no tools offered turns that into the
 * answer the person was waiting for instead of an error.
 */
const NO_TOOLS_NUDGE = 'The person is still waiting for an answer to their last message. Reply now in plain words, using what you already know or any results above. Do not call or describe any tool.';

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
 * `webTools` is whether the web search and page reading tools are being offered on
 * this message. It decides what the prompt says about the web, because a model told
 * flatly that it cannot see websites refuses a question it could have answered with
 * the search tool it was just given.
 * @param {{ agentPrompt?: string, projectPrompt?: string, skillsPrompt?: string, threadPrompt?: string, modePrompt?: string, settings?: object, webTools?: boolean, now?: Date }} [parts]
 * @returns {string}
 */
export function chatSystemPrompt(parts = {}) {
  return [
    ZURI_IDENTITY_PROMPT,
    parts.agentPrompt,
    parts.projectPrompt,
    parts.skillsPrompt,
    parts.threadPrompt,
    currentTimeContext(parts.now instanceof Date ? parts.now : new Date(), parts.webTools === true),
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
 *
 * The last line has to match the tools actually offered. Without web tools the model
 * is told it cannot see the web, which is true. With them, the same sentence makes it
 * deny a capability the person switched on and waste the search it never ran.
 * @param {Date} [now]
 * @param {boolean} [webTools] Whether webSearch and webFetch are offered this message.
 * @returns {string}
 */
function currentTimeContext(now = new Date(), webTools = false) {
  const date = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const clock = `Current local date and time where the user is: ${date}, ${time} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Use this whenever the user asks about today, the date, the day or the time.`;
  const web = webTools
    ? 'You have a web search tool and a page reading tool on this message. Run webSearch for anything current, recent, or after your training data, and webFetch to read a result before you rely on it. Never say you cannot look things up. If a search returns nothing useful, say that plainly instead of guessing.'
    : 'You still cannot see live websites or page contents unless a tool gives them to you.';
  return `${clock} ${web}`;
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

// A supplier's tool request sometimes arrives as text instead of a tool_calls field,
// and every spelling of that has to be read here or the request is printed in the
// chat as if it were the answer and the tool never runs. DeepSeek writes DSML markup
// (`<｜DSML｜function_calls>...`); Zuri Flash and the other OpenAI-compatible models
// write `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`.
const TOOL_MARKUP_START = /<[|｜\s]*DSML|<tool_call>/i;
const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
// A "<" that may be the first character of a tool block still arriving in the next
// chunk is not painted until it is known to be ordinary text.
const TOOL_MARKUP_HOLD_BACK = 16;

/**
 * How much of a half-arrived reply is safe to paint: everything before a tool block,
 * and none of a trailing "<" that a later chunk may turn into one.
 * @param {string} text
 * @returns {number}
 */
export function visiblePrefixLength(text) {
  const marker = text.search(TOOL_MARKUP_START);
  if (marker !== -1) return marker;
  const tail = text.lastIndexOf('<');
  return tail !== -1 && text.length - tail < TOOL_MARKUP_HOLD_BACK ? tail : text.length;
}

/**
 * One `<tool_call>` body as a call. Its arguments arrive as an object where every
 * other call carries them as a JSON string, so they are put back into that shape.
 * @param {string} body
 * @param {number} index
 * @returns {{ id: string, name: string, arguments: string } | null}
 */
function textToolCall(body, index) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON, so not a call. The block is still markup and is dropped with it.
    return null;
  }
  const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
  if (name === '') return null;
  const args = parsed.arguments ?? parsed.parameters ?? {};
  return {
    // The tool turn has to quote the id the assistant turn used as well, and a call
    // written into the text has none, so it is given one the supplier cannot reuse.
    id: `call_text_${index}`,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
  };
}

/**
 * Split reply text into what the person should read and any tool calls written into
 * it as markup. Markup always ends the readable part: a model that writes a call says
 * nothing after it.
 * @param {string} text
 * @returns {{ visible: string, calls: { id: string, name: string, arguments: string }[] }}
 */
export function splitToolCalls(text) {
  const source = typeof text === 'string' ? text : '';
  const start = source.search(TOOL_MARKUP_START);
  if (start === -1) return { visible: source, calls: [] };

  const calls = [];
  // DSML names the tool on an invoke tag and its arguments on parameter tags.
  const chunks = source.slice(start).split(/invoke\s+name="/).slice(1);
  for (const chunk of chunks) {
    const name = chunk.slice(0, chunk.indexOf('"'));
    if (name === '') continue;
    const args = {};
    for (const match of chunk.matchAll(/parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\s*\/[^>]*?parameter\s*>/g)) {
      args[match[1]] = match[2].trim();
    }
    calls.push({ id: `call_text_${calls.length}`, name, arguments: JSON.stringify(args) });
  }
  // The simpler spelling wraps the whole call, name and arguments, in JSON.
  for (const block of source.matchAll(TOOL_CALL_BLOCK)) {
    const call = textToolCall(block[1], calls.length);
    if (call !== null) calls.push(call);
  }
  return { visible: source.slice(0, start).trimEnd(), calls };
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

      // Stream only what comes before a tool block, and hold back a trailing "<"
      // that might be the start of one split across two chunks.
      const limit = visiblePrefixLength(reply);
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

  const split = splitToolCalls(reply);
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
 * What to say while a step is running, in the words a person would use.
 *
 * Said before the step rather than after it. A web search takes several seconds and
 * a window that shows nothing for that long reads as broken, so the small line under
 * the reply names the work in progress. The renderer appends its own ellipsis, so
 * nothing here ends in dots.
 * @param {string} name The tool the model asked for.
 * @param {Record<string, unknown>} args Its arguments, for the detail a name alone misses.
 * @returns {string} An empty string when there is nothing worth saying.
 */
export function statusForTool(name, args) {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  const file = typeof args?.path === 'string' ? args.path.split(/[\\/]/).pop() : '';
  const app = typeof args?.app === 'string' ? args.app.trim() : '';
  if (name === 'webSearch') return query === '' ? 'Searching the web' : `Searching the web for ${query.slice(0, 60)}`;
  if (name === 'webFetch') return 'Reading that page';
  if (name === 'readFile') return file === '' ? 'Reading the file' : `Reading ${file.slice(0, 60)}`;
  if (name === 'summarizeDocument') return file === '' ? 'Reading the document' : `Reading ${file.slice(0, 60)}`;
  if (name === 'writeFile' || name === 'createDocument' || name === 'editDocument') {
    return file === '' ? 'Writing the file' : `Writing ${file.slice(0, 60)}`;
  }
  if (name === 'openUrl') return 'Opening the page';
  if (name === 'openApp') return app === '' ? 'Opening the app' : `Opening ${app.slice(0, 40)}`;
  return 'Working on it';
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

/**
 * What Zuri is told about the document it is working in.
 *
 * The pane cannot read this reply the way a chat window can: it needs operations it
 * can carry out through Office's own API. So the contract is spelled out in full,
 * with the exact operation names and their fields, and the model is told plainly that
 * it cannot touch the file itself. Prose alone would leave the person copying and
 * pasting, which is the thing the pane exists to stop.
 */
const ADDIN_IDENTITY =
  'You are Zuri, an AI assistant made by Tijha. You are working inside Microsoft Office, in a small task pane beside the person\'s file. ' +
  'Never call yourself Claude, and never name another assistant or AI company as your maker. ' +
  'Write like a helpful colleague at the next desk: short plain sentences, no preamble, no restating the question, no asking permission you have already been given.';

/** The example the model copies, in the shape of the app it is running in. */
function addinExample(host) {
  if (host === 'excel') {
    return '  {"summary":"Fill the remaining column with formulas","operations":[{"op":"setFormulas","range":"E3:E26","formulas":[["=C3-D3"],["=C4-D4"]]}]}';
  }
  if (host === 'powerpoint') {
    return '  {"summary":"Add a closing slide","operations":[{"op":"addSlide","title":"Thank you","body":"Questions and next steps"}]}';
  }
  return '  {"summary":"Add a section heading","operations":[{"op":"insertParagraphs","where":"end","paragraphs":[{"text":"Where we are","style":"Heading 1"},{"text":"Revenue came in ahead of plan."}]}]}';
}

/**
 * The shared half of the contract: how a change is written and what it must respect.
 * The worked example is the host's own, because a model shown an Excel operation in
 * Word will sometimes copy it, and the pane would have to refuse the whole plan.
 */
function addinEditContract(host) {
  return [
    'You cannot change the file yourself. You propose the change, the person presses Apply, and Office carries it out.',
    '',
    'How to propose a change',
    '- Write one or two short sentences about what you are about to do, then one fenced block tagged zuri holding a single JSON object:',
    '  \u0060\u0060\u0060zuri',
    addinExample(host),
    '  \u0060\u0060\u0060',
    '- Put every operation in that one block, in the order it should run, at most 40.',
    '- If the person only asked a question, answer it and write no block at all.',
    '- Never say a change is done, saved, written or applied. The person applies it, and the next message shows you the file with the change in it.',
    '',
    'What the change must respect',
    '- Work only from the file content you are given. Never invent cells, labels, numbers, headings, slide text or names that are not there.',
    '- Use the real ranges and sheet names from the map you are given. Do not overwrite cells that already hold something unless the person asked for that.',
    '- Prefer formulas to typed-in numbers, so the file still adds up when a value changes.',
    '- A grid must be rectangular: every row in values or formulas needs the same number of cells.',
    '- Keep the JSON valid: double quotes around every key and string, no comments, no trailing commas.',
  ].join('\n');
}

/** The operation list for one host, so the model never sees a name it cannot use. */
function addinOperationList(host) {
  if (host === 'excel') {
    return [
      'Operations you can use here',
      '{"op":"setValues","range":"D3:D26","values":[[3000],[300]]}                    write literal values, one array per row',
      '{"op":"setFormulas","range":"E3:E26","formulas":[["=C3-D3"],["=C4-D4"]]}         write formulas; each string starts with "="',
      '{"op":"setNumberFormat","range":"F3:F26","format":"0.0%"}                       display format for cells',
      '{"op":"format","range":"A1:F1","bold":true,"fill":"#1F2A44","color":"#FFFFFF","size":12,"wrapText":true,"align":"center"}',
      '{"op":"columnWidth","range":"A1:F1","width":16}                                width of the columns the range touches',
      '{"op":"autofit","range":"A1:F30"}                                             fit columns and rows to their contents',
      '{"op":"addWorksheet","name":"Summary","activate":true}',
      '{"op":"clear","range":"G1:G30"}                                              clears the contents only',
      '{"op":"createTable","range":"A1:F30","name":"BudgetTable","hasHeaders":true}',
      '{"op":"addChart","range":"A1:B13","chartType":"column","title":"Spend by month","at":"D2"}   draws a chart beside the data',
      '',
      'Excel notes',
      '- Any range operation also takes "sheet":"Budget" to work on a sheet other than the active one.',
      '- Formulas use Excel syntax with a leading "=" and comma separators. Escape a double quote inside a formula: "=SUMIF($B$3:$B$26,\\\"Expense\\",$D$3:$D$26)".',
      '- Use $ for a reference that must not move when it is filled down, such as $C$3.',
      '- A percentage, a date or money is a number format, not text: write the number and set the format.',
      '- chartType is one of column, bar, line, pie, area or scatter. Label the columns the chart is drawn from, or the chart has no names.',
      '- Leave "at" out and the chart lands two columns right of the data. Give one cell such as "H2" to put it somewhere else.',
      '- The sheet map you are given starts each line with its row number and uses tabs between cells, so count nothing by eye.',
    ].join('\n');
  }
  if (host === 'powerpoint') {
    return [
      'Operations you can use here',
      '{"op":"addSlide","title":"Where we are","body":"Three points, one per line"}',
      '{"op":"setSlideTitle","slide":3,"title":"What changed this quarter"}',
      '{"op":"setShapeText","slide":3,"shape":"Title 1","text":"What changed this quarter"}',
      '{"op":"addTextBox","slide":3,"text":"...","left":40,"top":120,"width":540,"height":120,"size":18,"bold":true}',
      '{"op":"setSelectedText","text":"..."}                                        replaces the text the person selected',
      '',
      'PowerPoint notes',
      '- Slides number from 1, the way the thumbnail pane counts them.',
      '- Positions and sizes are in points. A 16:9 slide is 960 by 540, so keep text between 36 and 920 across and 24 and 500 down.',
      '- Keep a slide to one message. If the deck needs three points, that is one slide with three short lines, not three slides.',
    ].join('\n');
  }
  return [
    'Operations you can use here',
    '{"op":"replaceSelection","text":"..."}                                        replaces the selected text',
    '{"op":"insertAfterSelection","text":"..."}                                    adds a paragraph after the selection',
    '{"op":"insertParagraphs","where":"end","paragraphs":[{"text":"2026 budget","style":"Heading 1"},{"text":"Plain body text"}]}',
    '{"op":"applyStyle","style":"Heading 2"}                                       styles the selected text',
    '{"op":"replaceAll","find":"ACME","replace":"Zuri"}',
    '{"op":"insertTable","where":"end","rows":[["Region","Sales"],["Lagos","1200"]]}',
    '',
    'Word notes',
    '- "where" is one of start, end, afterSelection or replaceSelection.',
    "- Style names are Word's own: Title, Subtitle, Heading 1, Heading 2, Normal, Quote, List Bullet, List Number.",
    "- Keep the document's existing voice and heading levels. A rewrite replaces words, not structure, unless the person asked for a new structure.",
  ].join('\n');
}

/** @param {unknown} value @returns {'word'|'excel'|'powerpoint'} */
function normaliseAddinHost(value) {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return host === 'excel' ? 'excel' : host === 'powerpoint' ? 'powerpoint' : 'word';
}

/** The whole instruction for one host: identity, contract, operations, and the file's name. */
function addinSystemPrompt(host) {
  const name = host === 'excel' ? 'Microsoft Excel' : host === 'powerpoint' ? 'Microsoft PowerPoint' : 'Microsoft Word';
  const noun = host === 'excel' ? 'sheet' : host === 'powerpoint' ? 'deck' : 'document';
  return [
    'You are working in ' + name + ', in a task pane beside one ' + noun + '.',
    addinEditContract(host),
    addinOperationList(host),
  ].join('\n\n');
}

/** Longest slice of a document sent along with an add-in request; every character is billed. */
const ADDIN_CONTEXT_LIMIT = 30_000;

/** Longest single message kept from the pane's conversation, in characters. */
const ADDIN_MESSAGE_LIMIT = 6_000;

/** How many turns of the pane's conversation travel with a question. */
const ADDIN_TURN_LIMIT = 20;

const ADDIN_ROLES = new Set(['user', 'assistant']);

/**
 * The pane's conversation, cleaned: only the two roles, only text, and capped so a
 * long session cannot grow the request without bound.
 * @param {unknown} value
 * @returns {Array<{ role: string, content: string }>}
 */
function addinTurns(value) {
  const turns = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry?.content !== 'string' || !ADDIN_ROLES.has(entry.role)) continue;
    const content = entry.content.trim();
    if (content === '') continue;
    turns.push({ role: entry.role, content: content.slice(0, ADDIN_MESSAGE_LIMIT) });
  }
  return turns.slice(-ADDIN_TURN_LIMIT);
}

/**
 * One turn of the Office task pane: the conversation so far, the file as it stands,
 * and the host it is running in.
 *
 * The file is attached to the newest question rather than to every turn. Older turns
 * then stay short, and the answer is always given against what the file holds now,
 * which is what makes a follow-up like "now format that column" work after an apply.
 *
 * @param {{ messages?: unknown, host?: unknown, context?: unknown }} request
 * @param {{ cloudReply?: Function, fetchImpl?: typeof fetch, signal?: AbortSignal, emit?: (event: object) => void }} [options]
 * @returns {Promise<{ ok: true, data: { text: string, model: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function chatForAddin(request = {}, options = {}) {
  const turns = addinTurns(request.messages);
  if (!turns.some((turn) => turn.role === 'user')) {
    return failure('ADDIN_EMPTY_PROMPT', 'Type what you want Zuri to do first.');
  }

  const host = normaliseAddinHost(request.host);
  const noun = host === 'excel' ? 'sheet' : host === 'powerpoint' ? 'deck' : 'document';
  const context = typeof request.context === 'string' ? request.context.slice(0, ADDIN_CONTEXT_LIMIT) : '';

  const newest = turns[turns.length - 1];
  const conversationTurns = turns.slice(0, -1);
  conversationTurns.push({
    role: 'user',
    content: context.trim() === ''
      ? newest.content
      : newest.content + '\n\nCurrent content of the ' + noun + ':\n' + context,
  });

  const system = [ADDIN_IDENTITY, addinSystemPrompt(host), currentTimeContext()].join('\n\n');
  const settings = await readStore('settings');
  if (!settings.ok) return settings;

  if (typeof options.cloudReply === 'function') {
    const reply = await options.cloudReply({
      conversation: { system: system, turns: conversationTurns },
      settings: settings.data,
      signal: options.signal,
      emit: options.emit,
      tools: [],
    });
    if (reply?.ok !== true) return reply ?? failure('ADDIN_CLOUD_FAILED', 'Zuri could not answer that document request.');
    return {
      ok: true,
      data: {
        text: String(reply.data?.content ?? '').trim(),
        model: String(reply.data?.modelName || reply.data?.modelCode || 'Zuri'),
      },
    };
  }

  const { provider, model } = resolveChatTarget(settings.data);
  const key = getKey(provider);
  if (key === null) {
    return failure('CLOUD_AUTH_REQUIRED', 'Sign in to Zuri to use the Office add-in.');
  }
  const reply = await streamReply(provider, model, key, { system: system, turns: conversationTurns }, options);
  if (!reply.ok) return reply;
  return { ok: true, data: { text: reply.text.trim(), model: reply.label ?? 'Zuri' } };
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
    // The same flag decides whether the tools below are offered, so the prompt and
    // the tool list can never disagree about whether Zuri can search today.
    webTools: options.webSearch === true,
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
      // This round's own words, markup included, and how much of them has been
      // painted. A tool block is held back rather than typed into the reply.
      let heard = '';
      let painted = 0;
      const paint = (limit) => {
        if (limit <= painted) return;
        emit({ threadId, delta: heard.slice(painted, limit) });
        painted = limit;
      };
      reached = await options.cloudReply({
        conversation: { system: conversation.system, turns: wire },
        settings: modelSettings,
        tools: toolsForRound,
        signal: options.signal,
        emit: (event) => {
          if (typeof event.delta !== 'string') {
            emit({ threadId, ...event });
            return;
          }
          heard += event.delta;
          paint(visiblePrefixLength(heard));
        },
      });
      if (!reached.ok) break;

      // A supplier that writes its call into the text returns an empty calls field,
      // so this round's words are read for calls as well. What is left is what the
      // person reads and what gets saved, never the markup.
      const round = splitToolCalls(
        typeof reached.data?.content === 'string' && reached.data.content !== '' ? reached.data.content : heard,
      );
      if (!reached.data) reached.data = {};
      reached.data.content = round.visible;
      // Whatever was held back arrives now, including a "<" that turned out to be
      // ordinary text rather than the start of a block.
      if (round.visible.length > painted) {
        emit({ threadId, delta: round.visible.slice(painted) });
        painted = round.visible.length;
      }
      textSoFar += round.visible;

      const calls = [
        ...(Array.isArray(reached.data.toolCalls) ? reached.data.toolCalls : []),
        // Only a tool this round offers may run. Anything else is a request the round
        // cannot answer, so its markup is dropped and the words around it are shown.
        ...round.calls.filter((call) => toolsForRound.some((tool) => tool.name === call.name)),
      ];
      if (calls.length === 0 || toolsForRound.length === 0) break;

      // The call and its results have to travel with the next round, or the model
      // cannot see what it asked for or what came back.
      wire.push({ role: 'assistant', content: reached.data.content || '', toolCalls: calls });
      for (const call of calls) {
        const args = parseToolInput(call.arguments);
        // Announced before the step runs, so the wait has a name while it happens.
        emit({ threadId, status: statusForTool(call.name, args) });
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

    // A turn can end with nothing the person can read. The commonest cause is a
    // tool request written into the text for a tool this turn never offered: the
    // markup is stripped as markup, so the words around it are all that is left, and
    // often there are none. Asking once more with no tools offered is the difference
    // between a reply and a failure.
    const wordless = (value) => typeof value !== 'string' || value.trim() === '';
    if (reached.ok && wordless(reached.data?.content) && wordless(textSoFar)) {
      let askedAgain = '';
      let shownSoFar = 0;
      const retry = await options.cloudReply({
        // The nudge rides in the system instruction so a pretend turn from the person
        // is never added to the conversation the model reads.
        conversation: { system: `${conversation.system}\n\n${NO_TOOLS_NUDGE}`, turns: wire },
        settings: modelSettings,
        tools: [],
        signal: options.signal,
        emit: (event) => {
          if (typeof event.delta !== 'string') {
            emit({ threadId, ...event });
            return;
          }
          askedAgain += event.delta;
          // No tools are offered this round, so nothing but a half-arrived "<" is held back.
          const limit = visiblePrefixLength(askedAgain);
          if (limit > shownSoFar) {
            emit({ threadId, delta: askedAgain.slice(shownSoFar, limit) });
            shownSoFar = limit;
          }
        },
      });
      if (retry.ok) {
        const last = splitToolCalls(
          typeof retry.data?.content === 'string' && retry.data.content !== '' ? retry.data.content : askedAgain,
        );
        // A reply that arrived whole rather than as deltas was never painted above,
        // so the rest of it goes out now. Without this the answer would be saved and
        // the window would still look empty.
        if (last.visible.length > shownSoFar) {
          emit({ threadId, delta: last.visible.slice(shownSoFar) });
          shownSoFar = last.visible.length;
        }
        if (!retry.data) retry.data = {};
        retry.data.content = last.visible;
        reached = retry;
        textSoFar += last.visible;
      }
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
  // Nothing was written even after the second attempt. The store refuses an empty
  // message with "a message needs non-empty content", which says nothing to the
  // person waiting for an answer, so the real reason is given here instead.
  if (typeof reached.data?.content !== 'string' || reached.data.content.trim() === '') {
    return failure('CHAT_EMPTY_REPLY', 'Zuri did not write an answer that time. Send the message again.');
  }
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

  // Confirmation-gated tools (writeFile, openUrl, openApp) are left out on purpose:
  // a run happens with nobody watching, and starting an app or opening a link then
  // is not something the person can agree to at the time.
  const allowed = Array.isArray(request.allowedTools) ? request.allowedTools : null;
  const mode = request.mode === 'act' || request.mode === 'autopilot' ? request.mode : request.mode === 'ask' ? 'ask' : null;
  // Read before the prompt is built, because the prompt has to say the same thing
  // about the web as the tool list actually offers.
  const offersWebSearch = allowed === null || allowed.includes('webSearch');

  const conversation = {
    system: chatSystemPrompt({
      agentPrompt: agent !== null ? agent.systemPrompt : '',
      settings,
      webTools: offersWebSearch,
    }),
    turns: [{ role: 'user', content: prompt }],
  };

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
