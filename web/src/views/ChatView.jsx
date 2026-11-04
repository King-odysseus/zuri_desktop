import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { TextArea } from '@heroui/react';
import { AlignLeftIcon, ArchiveIcon, CheckIcon, ChevronLeftIcon, ChevronUpIcon, CloseIcon, CommandIcon, CopyIcon, DeleteIcon, EditIcon, EnhanceIcon, FileIcon, FolderIcon, ICON_SIZE, ImageIcon, MoreIcon, PanelLeftOpenIcon, PaperclipIcon, PinIcon, PlusIcon, RegenerateIcon, SendIcon, ShareIcon, SpeakIcon, StopIcon } from '../../../src/renderer-react/Icons.jsx';
import { Button, IconButton, InlineAlert, Input } from '../components/ui.jsx';
import ConversationSearch from '../components/ConversationSearch.jsx';
// The reply renderer and the clipboard fallback are the desktop app's own modules,
// imported rather than copied: an answer is then drawn by one set of markdown rules
// on both surfaces, and the code block's own copy button behaves the same way.
import FormattedMessage from '../../../src/renderer-react/FormattedMessage.jsx';
// The desktop's rewrite row, imported rather than copied: the browser chat had no
// rewrite buttons at all while the list lived inside the desktop panel.
import { QUICK_ADJUSTMENTS } from '../../../src/renderer-react/answerAdjustments.js';
// One description of a created to-do, reminder or automation, shared with the
// desktop window so the two cannot word the same card differently.
import { describeNotable } from '../../../src/shared/notableActions.js';
import { DOCUMENT_TOOL } from '../../../src/shared/documentTool.js';
import { speak, speechAvailable, stopSpeaking } from '../../../src/shared/speech.js';
import { copyText } from '../../../src/renderer-react/clipboard.js';
import { shareText } from '../lib/share.js';
import {
  DEFAULT_CHAT_MODEL,
  api,
  appendMessage,
  createAutomation,
  createConversation,
  createDocumentFile,
  createMemory,
  createReminder,
  createTask,
  deleteConversation,
  enhancePrompt,
  fetchConversation,
  fetchConversations,
  fetchPictureModels,
  fetchProjects,
  fileDisplayUrl,
  renameConversation,
  searchWeb,
  setConversationFlags,
  setConversationProject,
  streamChat,
  uploadFile,
} from '../lib/api.js';
import { HistoryIcon, LogoMark } from '../components/Icons.jsx';
import { formatRelativeTime, greetingFor } from '../lib/format.js';
import { clearChatDraft, readChatDraft, saveChatDraft } from '../lib/drafts.js';
import { deleteFiles, listFiles, saveFiles } from '../lib/fileStore.js';
// A picture made in the chat is filed with the pictures made on the Images page:
// one library, whichever screen drew it.
import { blobFromBase64, savePicture } from '../lib/imageStore.js';

/*
 * The chat models a customer can choose, in the order the plans climb. The codes
 * are the server's own (`server/src/models.js`); a plan that does not include one
 * is refused by the server, and that message is shown exactly as it arrives
 * rather than restated here.
 */
const CHAT_MODELS = [
  { code: 'zuri-flash', name: 'Zuri Flash' },
  { code: 'zuri-pro', name: 'Zuri Pro' },
  { code: 'zuri-max', name: 'Zuri Max' },
  { code: 'zuri-code', name: 'Zuri Core' },
  { code: 'zuri-reason', name: 'Zuri Reason' },
  { code: 'zuri-elite', name: 'Zuri Elite' },
];

/*
 * Only the tail of a long chat is sent with each question: the server accepts at
 * most fifty turns, and every one of them is spent against the plan's input
 * allowance, so a whole afternoon of history would cost more than the answer.
 */
const HISTORY_LIMIT = 20;

/*
 * The one tool the browser chat offers, and the most rounds it may take.
 *
 * A round that offers a tool is answered in one JSON body rather than a stream,
 * so the model's words and the search it wants run arrive together; the round
 * after that carries the search results back and is streamed as usual. The cap
 * exists because a model can keep asking for searches for ever, and the person
 * is waiting on every one of them.
 */
const MAX_TOOL_ROUNDS = 3;
const EMPTY_REPLY_NUDGE = 'Your previous response was empty. Answer the person now in plain words. Interpret obvious typing mistakes from context, and ask one short clarification only if two meanings are genuinely possible. Do not call or describe a tool.';

/**
 * Adding a to-do and setting a reminder ride with every message, the same way they
 * do in the desktop app: both are rows the person can edit or delete, so neither
 * needs a confirmation, and both are how a browser conversation stops being only
 * words. They differ from a search: the search answers the question, these leave
 * something behind in the account.
 */
const CREATE_TASK_TOOL = {
  name: 'createTask',
  description: 'Add a task to the Tasks page of the person you are helping. Use it when they ask you to remember or keep track of something to do, such as "add a task to send the file to Greg". Put what needs doing in title.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What the task is, in one short sentence.' },
      notes: { type: 'string', description: 'Optional extra detail.' },
      due: { type: 'string', description: 'Optional date the task is due, written as 2026-11-02.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Optional. normal unless they say it is urgent or can wait.' },
    },
    required: ['title'],
  },
};

const CREATE_MEMORY_TOOL = {
  name: 'createMemory',
  description: 'Save a short fact or preference across the person\'s chats and devices. Use it only when they clearly say remember this, save this for later, or otherwise ask Zuri to remember a fact. Do not save ordinary conversation details.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The short fact or preference to remember, written plainly.' },
    },
    required: ['content'],
  },
};

const CREATE_REMINDER_TOOL = {
  name: 'createReminder',
  description: 'Set a reminder so the person is notified at a moment they choose. Use it when they say "remind me", "let me know at 6", or ask to hear about something later. A reminder always needs a moment: if they gave none, ask for one instead of guessing.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What to remind them of.' },
      dueAt: { type: 'string', description: 'When to notify them, as a date and time like 2026-11-02T18:00.' },
      repeat: { type: 'string', enum: ['once', 'interval', 'daily'], description: 'Optional: once by default.' },
      intervalMinutes: { type: 'number', description: 'Only with repeat interval: minutes between reminders.' },
      timeOfDay: { type: 'string', description: 'Only with repeat daily: the 24-hour time, such as 09:30.' },
    },
    required: ['title', 'dueAt'],
  },
};

/*
 * An automation is the one tool here whose work happens with nobody watching: the
 * server runs the saved instruction on its own schedule. This chat has no approval
 * step for any tool, so it is created straight away like the other two, and the
 * card says plainly that it was created and when it next runs.
 */
const CREATE_AUTOMATION_TOOL = {
  name: 'createAutomation',
  description: 'Save an instruction for the server to carry out on a schedule by itself, searching the web if it needs to, and report back. Use it when the person asks for something to happen again and again without them asking each time, such as "every morning check for new project manager jobs in Scotland and summarise them". Put the whole instruction in prompt, as a sentence you would be happy to read back later with no other context.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The instruction to carry out each time, in full.' },
      cadence: {
        type: 'object',
        description: 'When it runs. Use type daily with timeOfDay, type interval with minutes, or type once with at.',
        properties: {
          type: { type: 'string', enum: ['once', 'daily', 'interval'], description: 'daily, interval or once.' },
          timeOfDay: { type: 'string', description: 'Only with type daily: the 24-hour time, such as 07:00.' },
          minutes: { type: 'number', description: 'Only with type interval: minutes between runs.' },
          at: { type: 'string', description: 'Only with type once: the date and time, like 2026-11-03T09:00.' },
        },
        required: ['type'],
      },
      deliverEmail: { type: 'boolean', description: 'True only if they asked to be emailed the result.' },
    },
    required: ['prompt', 'cadence'],
  },
};

const WEB_SEARCH_TOOL = {
  name: 'webSearch',
  description: 'Search the web. Use it for anything current or changing (news, prices, jobs, fixtures, opening times, releases) and whenever the person asks you to find, look up or link to pages, because your own knowledge stops at a fixed date.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for.' },
    },
    required: ['query'],
  },
};

/*
 * The three reply lengths, with the instruction each one adds to the question.
 * The wording is the desktop app's own (`src/main/providers/chat.js`) so the same
 * choice reads the same way on both surfaces. The cloud route carries no system
 * prompt, so the rule travels with the message and is not saved with it.
 */
const ANSWER_LENGTH_CHOICES = [
  ['concise', 'Concise', 'short'],
  ['balanced', 'Balanced', 'default'],
  ['detailed', 'Detailed', 'thorough'],
];

const ANSWER_LENGTH_RULES = {
  concise: 'Length: as short as the question allows. Answer in one or two sentences, then at most three short bullets, and leave out background nobody asked for.',
  balanced: 'Length: complete but not padded. The direct answer first, then the reasoning, the key steps or an example, and any caveat that changes what the person should do. Greetings and simple factual questions still get a short reply.',
  detailed: 'Length: thorough. The direct answer first, then the reasoning, steps, caveats, alternatives and worked examples that support it. Use headings once the answer has more than three sections.',
};

/*
 * Each command only fills the composer with a starter sentence, so nothing is
 * sent until the person finishes the sentence and presses Send. Same list as the
 * desktop composer, minus the ones only the desktop can carry out.
 */
const SLASH_COMMANDS = [
  { label: 'Summarise', text: 'Summarise this: ' },
  { label: 'Make a task', text: 'Turn this into a task: ' },
  { label: 'Set a reminder', text: 'Remind me to ' },
  { label: 'Draft a reply', text: 'Draft a reply to this: ' },
];

/* One row of the add menu. A menu item is a button, not a link, because nothing
   here navigates: each row changes the message being written. */
function MenuItem({ children, onSelect, role = 'menuitem', checked, className = '', disabled = false, title }) {
  return (
    <Button
      type="button"
      variant="ghost"
      role={role}
      aria-checked={role === 'menuitemradio' ? checked : undefined}
      isDisabled={disabled}
      title={title}
      className={`chat-menu-row ${className}`.trim()}
      onClick={onSelect}
    >
      {children}
    </Button>
  );
}

/* A sub-list's header, doubling as the way back to the main list. */
function MenuBack({ children, onBack }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="chat-menu-back"
      onClick={onBack}
    >
      <ChevronLeftIcon size={14} aria-hidden="true" />
      {children}
    </Button>
  );
}

/*
 * What the browser can attach.
 *
 * Two routes, because two kinds of file mean different things. A picture or a PDF
 * has no useful text, so its bytes go to this account's own file store and the
 * message carries a link to it: the server keeps and serves the file, and the
 * account stores only the link. A text file is read here and its words travel
 * inside the message, which keeps a small note cheap and searchable.
 */
const ATTACHMENT_TYPES = /.(txt|text|md|markdown|csv|tsv|json|log|yml|yaml|html|css|js|jsx|ts|tsx|py|sql|xml)$/i;
const ATTACHMENT_MAX_BYTES = 200_000;
/** The server's cap on one upload, repeated here so an oversized file is refused before it is read. */
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** The kinds the file store takes; matching image/png, image/jpeg, image/webp, image/gif, application/pdf. */
const UPLOAD_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

/**
 * The name a model code is shown under. The picker already holds the names, but the
 * composer's chip reads this so a code saved by an older build still shows a name
 * rather than a bare supplier id.
 * @param {string} code
 * @returns {string}
 */
function modelNameFor(code) {
  const found = CHAT_MODELS.find((entry) => entry.code === code);
  if (found) return found.name;
  const words = String(code ?? '').replace(/^zuri-/, '').replace(/[-_]+/g, ' ').trim();
  return words === '' ? 'Zuri' : `Zuri ${words.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
}

/** Epoch milliseconds for a conversation, or 0 when the server sent no usable date. */
function stamp(conversation) {
  const value = conversation?.updatedAt ?? conversation?.createdAt ?? 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * One line of what was last said in a chat, for the row under its name.
 *
 * A name alone cannot tell two chats about the same subject apart, so the row quotes
 * the last message. The server clips to 240 characters; newlines collapse here so a
 * pasted table or a code block still reads as one line, and the row clips the rest.
 */
function previewOf(conversation) {
  return String(conversation?.preview ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Newest first, whatever order the server answered in. */
/*
 * ChatGPT puts a long history under period headings, so a week of chats reads as
 * a few stretches rather than one undifferentiated list. The heading is attached
 * to the first chat of each stretch and drawn by the row's own CSS, which keeps
 * markup and behaviour apart.
 */
function dayBucket(conversation) {
  const when = stamp(conversation);
  if (!when) return 'Older';
  const days = Math.floor((Date.now() - when) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 days';
  if (days <= 30) return 'Previous 30 days';
  return 'Older';
}

function withGroupHeadings(conversations, searching) {
  let previous = '';
  return conversations.map((conversation) => {
    // A search result list is answering one question, so period headings would
    // only push the matches apart.
    const bucket = searching ? '' : dayBucket(conversation);
    const heading = bucket === previous ? '' : bucket;
    previous = bucket;
    return { conversation, heading };
  });
}

function newestFirst(conversations) {
  return [...conversations].sort((left, right) => stamp(right) - stamp(left));
}

/** A saved chat is named from its first question, which is enough to recognise it later. */
function titleFromQuestion(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}...`;
}

/**
 * The address a stored file is drawn from, and opened by.
 *
 * A turn that has just been sent already carries a finished address, because the
 * upload answered with one. A turn loaded from the account carries only the
 * file's own path, and an image tag cannot send the Authorization header, so the
 * token is added at draw time. The link uses the same address rather than the
 * bare path, or opening the file in a new tab would be refused.
 * @param {{ url?: string, displayUrl?: string } | null} attachment
 * @returns {string}
 */
function fileAddress(attachment) {
  if (!attachment) return '';
  const ready = typeof attachment.displayUrl === 'string' ? attachment.displayUrl : '';
  if (ready !== '') return ready;
  return fileDisplayUrl(attachment.url ?? '');
}

/**
 * What the model is told about a file it cannot read.
 *
 * The old wording ("its contents are not readable here") left a model with
 * nothing to say, so a picture came back with a vague reply or a guess dressed
 * up as one. The note now states what happened, forbids pretending to look, and
 * says what to do instead: one short sentence, then a question. A caption the
 * person typed travels beside this note as their own message, so it can still be
 * answered normally.
 * @param {{ name?: string, kind?: string }} attached
 * @returns {string}
 */
function unreadableFileNote(attached) {
  const name = attached.name || 'a file';
  const kind = attached.kind || 'unknown kind';
  if (String(kind).startsWith('image/')) {
    return [
      `A picture came with this message: ${name} (${kind}).`,
      'This chat cannot see inside a picture, so do not describe it, guess at what it shows, or claim to have looked at it.',
      'Say in one short sentence that you cannot see the picture here, then ask what they want done with it.',
      'If they wrote something with it, answer that, and mention the picture only if it matters.',
    ].join('\n');
  }
  return `A file came with this message: ${name} (${kind}). Its contents are not readable here.`;
}

/**
 * Only the two roles a bubble can show. A stored tool turn is part of the machine
 * side of a reply, so it is left out rather than printed as if Zuri had said it.
 */
function chatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
      // A turn may carry one uploaded file. It is passed through as the server
      // sent it, and the bubble decides how to draw it.
      attachment: message.attachment ?? null,
    }));
}

/*
 * What a search call is asking for.
 *
 * The arguments arrive from the model as a JSON string, and a model can send
 * anything, so a string that will not parse, or one carrying no query, becomes a
 * sentence the model is told rather than an exception that ends the reply.
 */
function webSearchQuery(call) {
  let parsed = call?.arguments;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { error: 'That search could not run: its arguments were not valid JSON.' };
    }
  }
  const query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
  if (query === '') return { error: 'That search could not run: no query was given.' };
  return { query };
}

/*
 * The words the model reads after a search: the numbered results, or one plain
 * sentence saying there were none. Every word of it is spent against the plan's
 * input allowance on the next round, so the snippet is kept and nothing is added.
 */
function searchResultsText(query, results) {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return `No web results were found for "${query}".`;
  const lines = list.map((entry, index) => {
    const title = typeof entry?.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : 'Untitled result';
    const url = typeof entry?.url === 'string' ? entry.url : '';
    const snippet = typeof entry?.snippet === 'string' ? entry.snippet.trim() : '';
    return [`${index + 1}. ${title}`, url, snippet].filter((part) => part !== '').join('\n');
  });
  return [`Web results for "${query}":`, ...lines].join('\n\n');
}

/*
 * Stop, as the browser reports it, so a loop that is stopped between rounds ends
 * down the same path as a request aborted mid-answer: what has arrived stays on
 * screen and no error is announced.
 */
function stoppedReply() {
  const error = new Error('The reply was stopped.');
  error.name = 'AbortError';
  return error;
}

/*
 * Run one tool call and return the text the model will read for it.
 *
 * Almost nothing here throws: a search that fails, a tool this chat does not
 * offer, and arguments that will not parse all come back as sentences, because a
 * model that is told what went wrong can still answer, while a thrown error
 * would end the person's reply. Stop is the one exception, since a stopped reply
 * must not turn into another request.
 */
/**
 * A call's arguments as an object. The server hands them over as a JSON string, but a
 * supplier that writes its own call can send an object, and a model can emit broken
 * JSON. None of those may throw at the person: a call that cannot be read becomes an
 * empty set of arguments, and the tool then says what it is missing.
 * @param {{ arguments?: unknown }} call
 * @returns {Record<string, unknown>}
 */
function toolArguments(call) {
  const raw = call?.arguments;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The cadence an automation call is asking for, in the shape the API takes.
 *
 * A model can send anything, and a schedule that is nearly right is worse than
 * none: an automation with an unreadable interval would either never run or run
 * for ever. So each of the three shapes is checked and only its own field is
 * passed on, and anything else comes back as a sentence the model can act on.
 * @param {unknown} value The cadence object the model sent.
 * @returns {{ value: object } | { error: string }}
 */
function automationCadence(value) {
  const shape = value !== null && typeof value === 'object' ? value : {};
  const type = typeof shape.type === 'string' ? shape.type.trim().toLowerCase() : '';

  if (type === 'daily') {
    const time = typeof shape.timeOfDay === 'string' ? shape.timeOfDay.trim() : '';
    const parts = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!parts) return { error: 'A daily automation needs the time of day, written as 07:00, and none was readable. Ask what time it should run.' };
    // The API stores HH:MM, so a model that wrote 7:00 is padded rather than refused.
    return { value: { type: 'daily', timeOfDay: `${parts[1].padStart(2, '0')}:${parts[2]}` } };
  }

  if (type === 'interval') {
    const minutes = Math.round(Number(shape.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: 'A repeating automation needs the minutes between runs, and none was readable. Ask how often it should run.' };
    return { value: { type: 'interval', minutes } };
  }

  if (type === 'once') {
    const at = new Date(String(shape.at ?? ''));
    if (Number.isNaN(at.getTime())) return { error: 'A one-off automation needs the moment to run, and none was readable. Ask when it should run.' };
    return { value: { type: 'once', at: at.toISOString() } };
  }

  return { error: 'That automation was not saved: its schedule has to be daily, interval or once. Ask which one they want.' };
}

/** The schedule in the card's own words, lowercased to sit mid-sentence. */
function automationScheduleWords(automation) {
  const card = describeNotable('automation', automation);
  const line = card?.lines?.find((entry) => entry.label === 'Runs');
  return typeof line?.value === 'string' ? line.value.toLowerCase() : '';
}

async function runToolCall(call, signal, onStatus, onNotable) {
  const name = typeof call?.name === 'string' ? call.name : '';
  const args = toolArguments(call);

  if (name === CREATE_MEMORY_TOOL.name) {
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (content === '') return 'A memory needs some text, so nothing was saved. Ask what they want remembered.';
    onStatus('Saving that as a memory');
    try {
      const memory = await createMemory(content);
      if (signal?.aborted) throw stoppedReply();
      return `Saved this memory: "${memory?.content ?? content}". They can edit or delete it from Account.`;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw stoppedReply();
      return `The memory was not saved: ${error?.message || 'the account refused it.'}`;
    }
  }

  // A to-do and a reminder are written straight into the account, so the sentence
  // is said before the request rather than after it, and a refusal is handed back
  // to the model in words it can act on.
  if (name === CREATE_TASK_TOOL.name) {
    if (typeof args.title !== 'string' || args.title.trim() === '') return 'A task needs a title, so nothing was added. Ask what the task should say.';
    onStatus(`Adding the task "${args.title.trim()}"`);
    try {
      const task = await createTask({
        title: args.title.trim(),
        notes: typeof args.notes === 'string' ? args.notes : '',
        due: typeof args.due === 'string' ? args.due : '',
        priority: typeof args.priority === 'string' ? args.priority : 'normal',
      });
      if (signal?.aborted) throw stoppedReply();
      // Handed over before the sentence, so the card appears with the confirmation
      // rather than after the whole reply has finished.
      if (typeof onNotable === 'function') onNotable('task', task);
      return `Added the task "${task?.title ?? args.title.trim()}" to their Tasks page.`;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw stoppedReply();
      return `The task was not added: ${error?.message || 'the account refused it.'}`;
    }
  }

  if (name === CREATE_REMINDER_TOOL.name) {
    const due = new Date(String(args.dueAt ?? ''));
    if (Number.isNaN(due.getTime())) return 'A reminder needs the moment to fire, and none was readable. Ask when they want to be reminded.';
    onStatus(`Setting a reminder for ${due.toLocaleString()}`);
    try {
      const reminder = await createReminder({
        title: typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'Reminder',
        dueAt: due.toISOString(),
        repeat: typeof args.repeat === 'string' ? args.repeat : 'once',
        intervalMinutes: typeof args.intervalMinutes === 'number' ? args.intervalMinutes : undefined,
        timeOfDay: typeof args.timeOfDay === 'string' ? args.timeOfDay : undefined,
      });
      if (signal?.aborted) throw stoppedReply();
      if (typeof onNotable === 'function') onNotable('reminder', reminder);
      return `Set a reminder for ${due.toLocaleString()}: "${reminder?.title ?? 'Reminder'}".`;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw stoppedReply();
      return `The reminder was not set: ${error?.message || 'the account refused it.'}`;
    }
  }

  if (name === CREATE_AUTOMATION_TOOL.name) {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (prompt === '') return 'An automation needs the instruction it should carry out, so nothing was saved. Ask what it should do each time.';
    const cadence = automationCadence(args.cadence);
    if (cadence.error) return cadence.error;
    onStatus('Setting up the automation');
    try {
      const automation = await createAutomation({
        prompt,
        cadence: cadence.value,
        // Email is opt-in: only a person who asked for it gets one, so anything
        // other than a plain true is read as no.
        deliverEmail: args.deliverEmail === true,
      });
      if (signal?.aborted) throw stoppedReply();
      if (typeof onNotable === 'function') onNotable('automation', automation);
      const schedule = automationScheduleWords(automation);
      return `Saved an automation on their Automations page: "${automation?.prompt ?? prompt}"${schedule === '' ? '' : `, running ${schedule}`}. Zuri runs it on the server, so it happens whether or not they are here.`;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw stoppedReply();
      return `The automation was not saved: ${error?.message || 'the account refused it.'}`;
    }
  }

  if (name === DOCUMENT_TOOL.name) {
    onStatus('Building your file');
    try {
      const file = await createDocumentFile({ kind: args.kind, fileName: args.fileName, content: args.content });
      if (signal?.aborted) throw stoppedReply();
      if (typeof onNotable === 'function') onNotable('document', file);
      const problems = file.warnings.length > 0
        ? ` These problems were found: ${file.warnings.join(' ')} Fix them and create the file once more, then tell the person which file to use.`
        : '';
      return `Built "${file.name}" and put a Download button for it under this reply. Tell them it is ready in one short sentence.${problems}`;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw stoppedReply();
      return `The file was not made: ${error?.message || 'the server refused it.'}`;
    }
  }

  if (name !== WEB_SEARCH_TOOL.name) return `The tool "${name}" is not available in this chat.`;

  const asked = webSearchQuery(call);
  if (asked.error) return asked.error;

  onStatus(`Searching the web for "${asked.query}"`);
  try {
    const results = await searchWeb(asked.query);
    if (signal?.aborted) throw stoppedReply();
    onStatus('Reading the results');
    return searchResultsText(asked.query, results);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw stoppedReply();
    // Told to the model rather than swallowed: it can say the search did not run
    // and answer from what it already knows, so the person still gets a reply.
    return `The web search failed: ${error?.message || 'the search service did not answer.'}`;
  }
}

/**
 * Hand a file the server built to the person. On an Android phone it goes to the share
 * sheet, because a download link inside the app's web view often saves nothing; every
 * other browser gets an ordinary download, and so does a phone whose share sheet cannot
 * take files.
 */
async function saveGeneratedFile(file) {
  const binary = atob(file.base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const onAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  if (onAndroid && typeof navigator.canShare === 'function' && typeof File === 'function') {
    const shared = new File([bytes], file.name, { type: file.mime });
    if (navigator.canShare({ files: [shared] })) {
      try {
        await navigator.share({ files: [shared], title: file.name });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure; anything else falls through to a download.
        if (error?.name === 'AbortError') return;
      }
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The failure a screen shows: the server's own sentence and status, never a guess. */
function failureOf(error, fallback) {
  return { message: error?.message || fallback, status: Number(error?.status) || 0 };
}

/**
 * Chat with saved history.
 *
 * Two panes: the account's conversations on the left, the open one on the right.
 * Below 900px only one pane is on screen at a time, because a 390px window has no
 * room for both, and the open chat carries a back button to the list.
 *
 * `onOpenHistory` is the screen that holds the chats this list no longer shows, so
 * the header beside Recents can reach it; without one the control does nothing.
 */
export default function ChatView({
  onSignIn,
  userName = '',
  navigation = null,
  navCollapsed = false,
  onToggleCollapsed = () => {},
  // When the dashboard opens chat from inside a project, that project's id arrives
  // here. Every new thread is then filed into it, and the list only shows its own.
  projectId = '',
  projectName = '',
  onLeaveProject = null,
  onOpenHistory = () => {},
  historyVersion = 0,
}) {
  const [conversations, setConversations] = useState([]);
  const [listStatus, setListStatus] = useState('loading');
  const [listError, setListError] = useState(null);
  const [conversationQuery, setConversationQuery] = useState('');

  const [openId, setOpenId] = useState(null);
  // A new chat has no conversation row yet: it is created on the first send.
  const [composing, setComposing] = useState(false);
  /*
   * A phone fits one pane at a time, so the saved chats are a screen of their own
   * there and need a close control. True keeps that screen in front, as it was
   * before this state existed. A wide screen docks both panes side by side and
   * never reads it.
   */
  const [listOpen, setListOpen] = useState(false);
  const [thread, setThread] = useState({ title: 'New chat', messages: [] });
  const [threadStatus, setThreadStatus] = useState('idle');
  const [threadError, setThreadError] = useState(null);

  const [draft, setDraft] = useState(() => readChatDraft());
  // The prompt enhancer: `enhancing` covers the round trip, and `enhancedFrom` holds the
  // person's own words while the rewritten ones sit in the box, so the same button can
  // put them back before anything is sent.
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedFrom, setEnhancedFrom] = useState(null);
  const [enhanceNote, setEnhanceNote] = useState('');
  // What the enhancer thought the message was missing: short lines the person can fold
  // into the prompt with one press. They sit under the box rather than in it, because
  // they are advice about the ask, not part of it until it is taken.
  const [enhanceSuggestions, setEnhanceSuggestions] = useState([]);
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  // The picture models are the server's catalogue, not a list repeated here: a plan
  // decides which of them this account may use, and the picker says so.
  const [pictureModels, setPictureModels] = useState([]);
  const [drawing, setDrawing] = useState(false);
  // Declared with the state rather than lower down, because the send callback's
  // dependency list reads it while the component is still rendering.
  const pictureModel = pictureModels.find((entry) => entry.code === model) ?? null;
  const modelName = pictureModel?.name || modelNameFor(model);
  const [streaming, setStreaming] = useState(false);
  const [streamReply, setStreamReply] = useState('');
  /*
   * What the search round is doing, shown inside the streaming bubble. A tool
   * round comes back as one body, so it paints nothing until it is over; without
   * this line the person watches an empty bubble and cannot tell it from a hang.
   */
  const [toolStatus, setToolStatus] = useState('');
  const [streamError, setStreamError] = useState(null);
  // What this reply has created so far, painted under it as it goes.
  const [notables, setNotables] = useState([]);
  const [saveWarning, setSaveWarning] = useState('');
  // One file at a time, as the desktop composer allows, so the message stays one turn.
  const [attachment, setAttachment] = useState(null);
  const [attachNote, setAttachNote] = useState('');
  // '' keeps the add menu closed. The desktop composer's own four views: the main
  // list, a reply length, the picture models and the starter sentences.
  const [menuView, setMenuView] = useState('');
  const [answerLength, setAnswerLength] = useState('balanced');
  // The model list is its own popup, anchored to its own chip. It is not a
  // floating-ui panel because that drifted off the trigger when the chip shrank
  // to a few characters on a phone.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  // Which chat row has its actions menu open. Only one at a time, as ChatGPT does.
  const [rowMenuId, setRowMenuId] = useState(null);
  // The row menu's project list is a second view inside the same menu, so choosing
  // where a chat belongs does not open a dialog over the conversation.
  const [projectPickerFor, setProjectPickerFor] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectsStatus, setProjectsStatus] = useState('');
  const [filingId, setFilingId] = useState('');
  // Which bubble was just copied, so its button can say so for a moment. -1 means
  // none, because index 0 is a real message.
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [copyNote, setCopyNote] = useState('');
  // Which reply is being read aloud, so its button can offer Stop.
  const [speakingIndex, setSpeakingIndex] = useState(-1);
  const [shareNote, setShareNote] = useState('');
  const [incognito, setIncognito] = useState(false);

  const messagesRef = useRef(null);
  const draftRef = useRef(null);
  const fileRef = useRef(null);
  const menuRef = useRef(null);
  const modelMenuRef = useRef(null);
  const abortRef = useRef(null);
  // Files built during the reply in flight, written to this device once the chat has an id.
  const pendingFilesRef = useRef([]);
  /*
   * Bumped whenever the open chat changes. A reply still arriving from the chat
   * the person just left checks this before painting anything, so a late delta
   * cannot land in somebody else's conversation.
   */
  const runRef = useRef(0);
  const atBottomRef = useRef(true);

  const loadConversations = useCallback(async (query = '') => {
    setListStatus('loading');
    try {
      setConversations(newestFirst(await fetchConversations(query, projectId)));
      setListError(null);
    } catch (error) {
      setListError(failureOf(error, 'Your saved chats could not be loaded.'));
    } finally {
      setListStatus('ready');
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConversations(conversationQuery);
    }, conversationQuery.trim() === '' ? 0 : 220);
    return () => window.clearTimeout(timer);
    // historyVersion moves when a chat is deleted or restored on the history screen,
    // so the list is built again instead of keeping a row that no longer exists.
  }, [conversationQuery, loadConversations, historyVersion]);

  useEffect(() => {
    saveChatDraft(draft);
  }, [draft]);

  // A row menu closes on Escape or on a press anywhere else, which is what a menu
  // is expected to do. Without it the panel stayed open behind the next action.
  useEffect(() => {
    if (rowMenuId === null) return undefined;
    const closeOnPress = (event) => {
      if (event.target.closest?.('.chat-row-menu')) return;
      if (event.target.closest?.('[aria-expanded="true"]')) return;
      setRowMenuId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setRowMenuId(null);
    };
    document.addEventListener('pointerdown', closeOnPress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [rowMenuId]);

  /*
   * The same conversation can be moving on another device: the desktop app mirrors
   * its threads to this account and a second tab may be open. Nothing can be pushed
   * to a page, so it re-reads when it comes back into view and once a minute while it
   * is on screen. A reply already arriving is never interrupted.
   */
  const refreshHistory = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      setConversations(newestFirst(await fetchConversations(conversationQuery, projectId)));
      setListError(null);
    } catch {
      // A background refresh is a nicety: the list already on screen stays put, and
      // an error banner would report a failure nobody asked for.
    }
    if (!openId || streaming) return;
    const run = runRef.current;
    try {
      const data = await fetchConversation(openId);
      if (run !== runRef.current) return;
      const messages = chatMessages(data.messages);
      // Only a longer thread is taken: a shorter one means this tab holds turns the
      // account has not accepted yet, and dropping them would lose the person's text.
      setThread((previous) => (
        messages.length > previous.messages.length
          ? { title: data.title ?? previous.title, messages }
          : previous
      ));
    } catch {
      // Same reasoning as the list: what is open stays open.
    }
  }, [conversationQuery, openId, streaming, projectId]);

  useEffect(() => {
    const onVisible = () => {
      void refreshHistory();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [refreshHistory]);

  /**
   * Take the chosen file. A text file is read here and held in memory, so its words
   * travel with the next message, the way the desktop app puts an attached file in
   * front of the question. A picture or a PDF is sent to this account's own file
   * store and only the link travels.
   */
  const chooseAttachment = useCallback(async (event) => {
    const file = event.target.files?.[0];
    // Cleared straight away so choosing the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;

    // A picture or a PDF goes to this account's own file store, so the browser
    // never has to turn it into text it cannot read and the message carries a
    // link to the bytes rather than the bytes themselves.
    if (UPLOAD_TYPES.test(file.type)) {
      if (file.size > UPLOAD_MAX_BYTES) {
        setAttachNote('That file is over 4MB. Try a smaller one.');
        return;
      }
      setAttachNote('Uploading...');
      try {
        const uploaded = await uploadFile(file);
        // displayUrl is the same file with this tab's token in the query string,
        // because an image tag cannot send the Authorization header. The plain
        // path stays on `url`, which is what the saved turn keeps.
        setAttachment({ ...uploaded, text: '', size: file.size });
        setAttachNote('');
      } catch (error) {
        // The message is the server's own wording where it gave one, so a size or
        // type refusal reads as an instruction rather than a generic failure.
        setAttachNote(error?.message || 'That file could not be uploaded. Try again.');
      }
      return;
    }

    if (!ATTACHMENT_TYPES.test(file.name)) {
      setAttachNote('The web chat can attach text files, pictures and PDFs. Anything else opens in the desktop app.');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setAttachNote('That text file is over 200 KB. Try a smaller one, or attach it in the desktop app.');
      return;
    }
    try {
      setAttachment({ name: file.name, size: file.size, text: await file.text() });
      setAttachNote('');
    } catch {
      setAttachNote('That file could not be read. Try choosing it again.');
    }
  }, []);

  const resetReply = useCallback(() => {
    setStreamReply('');
    setStreamError(null);
    // A file's card stays for the whole chat; the other cards belong to one reply.
    setNotables((rows) => rows.filter((row) => row.kept));
    setSaveWarning('');
    setToolStatus('');
  }, []);

  const openConversation = useCallback(
    async (id) => {
      runRef.current += 1;
      abortRef.current?.abort();
      setOpenId(id);
      setComposing(false);
      setThread({ title: '', messages: [] });
      setThreadStatus('loading');
      setThreadError(null);
      setRenamingId(null);
      setConfirmId(null);
      resetReply();
      setNotables([]);
      atBottomRef.current = true;
      const run = runRef.current;
      try {
        const data = await fetchConversation(id);
        setThread({ title: data.title ?? 'Untitled chat', messages: chatMessages(data.messages) });
        // A chat keeps the model it was started on, as the desktop transcript does, so
        // a thread begun on Zuri Pro opens on Zuri Pro instead of whatever this tab
        // last had selected. A code the picker does not offer is ignored.
        if (CHAT_MODELS.some((entry) => entry.code === data.model)) setModel(data.model);
        setThreadStatus('ready');
        // Files this device built for the chat get their Download cards back.
        void listFiles(id).then((files) => {
          if (run !== runRef.current) return;
          setNotables(files.map((file, index) => ({ ...describeNotable('document', file), id: `document-kept-${index}-${file.name}`, file, kept: true })).filter((card) => card.badge));
        });
      } catch (error) {
        setThreadError(failureOf(error, 'This chat could not be opened.'));
        setThreadStatus('error');
      }
    },
    [resetReply],
  );

  const startNewChat = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    setOpenId(null);
    setComposing(true);
    setThread({ title: 'New chat', messages: [] });
    setThreadStatus('ready');
    setThreadError(null);
    setRenamingId(null);
    setConfirmId(null);
    setDraft('');
    setEnhancedFrom(null);
    setEnhanceNote('');
    clearChatDraft();
    resetReply();
    setNotables([]);
    atBottomRef.current = true;
  }, [resetReply]);

  /*
   * Clicking anywhere else, or pressing Escape, closes the add menu. The menu holds
   * no form field, so a stray click behind it should dismiss it rather than leave a
   * panel open over the composer.
   */
  useEffect(() => {
    if (menuView === '') return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && menuRef.current?.contains(event.target)) return;
      setMenuView('');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuView]);

  // The same dismissal for the model list: a click elsewhere or Escape closes it.
  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && modelMenuRef.current?.contains(event.target)) return;
      setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [modelMenuOpen]);

  // Every row closes the menu first, so a chosen item never leaves it hanging open.
  function pickMenuItem(action) {
    setMenuView('');
    action();
  }

  function insertCommand(text) {
    setDraft((current) => (current.trim() === '' ? text : `${current.trimEnd()}\n${text}`));
    draftRef.current?.focus();
  }

  const backToList = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    setOpenId(null);
    setComposing(false);
    setListOpen(true);
    setThread({ title: 'New chat', messages: [] });
    setThreadStatus('idle');
    setThreadError(null);
    setConfirmId(null);
    resetReply();
  }, [resetReply]);

  /**
   * Store a finished exchange. A brand new chat gets its conversation row here,
   * on the first send, so opening a chat and changing your mind saves nothing.
   */
  const saveExchange = useCallback(
    async (conversationId, question, answer, run, attachment = null, privateChat = false) => {
      if (privateChat) return;
      const title = titleFromQuestion(question);
      try {
        let id = conversationId;
        if (!id) {
          const created = await createConversation(title, model, projectId);
          id = typeof created?.id === 'string' ? created.id : '';
          if (!id) throw new Error('The new chat did not come back with an id.');
          if (run === runRef.current) {
            setOpenId(id);
            setComposing(false);
            setThread((previous) => ({ ...previous, title: created?.title ?? title }));
          }
        }
        await appendMessage(id, [
          { role: 'user', content: question, attachment },
          { role: 'assistant', content: answer },
        ]);
        // Only a chat that is saved keeps its files; a private chat returned above.
        if (pendingFilesRef.current.length > 0) {
          const files = pendingFilesRef.current;
          pendingFilesRef.current = [];
          await saveFiles(id, files);
        }
        if (run === runRef.current) loadConversations();
      } catch (error) {
        if (run !== runRef.current) return;
        // The messages stay on screen: losing the reply would be the worse
        // outcome, so a failed save is a warning and not an error.
        setSaveWarning(
          Number(error?.status) === 401
            ? 'Your session expired, so this chat may not be saved. Sign in again to keep your chats.'
            : 'This chat may not be saved. Check your connection and try again.',
        );
      }
    },
    [loadConversations, model, projectId],
  );

  /**
   * Rewrite the message box into a clearer prompt, or put the person's own words back.
   *
   * The rewrite replaces the draft instead of being sent, so it can be read and edited
   * first, and the same button undoes it. Typing by hand clears the undo, because
   * restoring then would throw away what they just wrote.
   * @returns {Promise<void>}
   */
  const enhance = useCallback(async () => {
    if (enhancing) return;
    if (enhancedFrom !== null) {
      setDraft(enhancedFrom);
      setEnhancedFrom(null);
      setEnhanceNote('');
      setEnhanceSuggestions([]);
      return;
    }
    const prompt = draft.trim();
    if (prompt === '') {
      setEnhanceNote('Write the message you want improved first.');
      return;
    }
    // A picture request reads only words, so the enhancer works on it too; nothing
    // here depends on the model picked.
    setEnhanceNote('');
    setEnhanceSuggestions([]);
    setEnhancing(true);
    try {
      const improved = await enhancePrompt(prompt);
      const text = typeof improved?.prompt === 'string' ? improved.prompt.trim() : '';
      if (text === '') {
        setEnhanceNote('That message could not be improved. Try again.');
        return;
      }
      setEnhancedFrom(draft);
      setDraft(text);
      // Only a list of lines is shown; anything else from the server is ignored rather
      // than drawn as an empty row.
      setEnhanceSuggestions(
        Array.isArray(improved?.suggestions)
          ? improved.suggestions.filter((suggestion) => typeof suggestion === 'string' && suggestion.trim() !== '')
          : [],
      );
    } catch (error) {
      setEnhanceNote(
        Number(error?.status) === 401
          ? 'Sign in again to improve prompts.'
          : error?.message ?? 'That message could not be improved. Try again.',
      );
    } finally {
      setEnhancing(false);
    }
  }, [draft, enhancedFrom, enhancing]);

  /**
   * Fold one suggested addition into the prompt.
   *
   * The line joins the message on its own line, so it reads as the requirement it is,
   * and it leaves the list: the same detail is not offered twice. The caret stays in
   * the box, at the end, ready for the next thing they want to say.
   * @param {string} suggestion
   * @returns {void}
   */
  const addSuggestion = useCallback((suggestion) => {
    setDraft((current) => {
      const base = current.replace(/\s+$/, '');
      if (base.includes(suggestion)) return base;
      return base === '' ? suggestion : `${base}\n${suggestion}`;
    });
    setEnhanceSuggestions((list) => list.filter((item) => item !== suggestion));
    requestAnimationFrame(() => {
      const box = draftRef.current;
      if (box && typeof box.focus === 'function') {
        box.focus();
        const end = box.value.length;
        if (typeof box.setSelectionRange === 'function') box.setSelectionRange(end, end);
      }
    });
  }, []);

  const send = useCallback(async (questionOverride = null, { rewrite = false } = {}) => {
    const question = (typeof questionOverride === 'string' ? questionOverride : draft).trim();
    // Regenerating re-asks an earlier question, so only a fresh send carries the file.
    const attached = questionOverride === null ? attachment : null;
    if ((!question && !attached) || streaming) return;

    // A picture request reads only words, so a file waiting to go is refused rather
    // than quietly left out of the picture it has no part in.
    if (pictureModel && attached) {
      setAttachNote('Picture models work from your words only. Remove the file, or pick a chat model.');
      return;
    }

    // What the model reads. A text file is quoted under a heading, the way the
    // desktop places an attachment in front of the prompt. A picture or a PDF has
    // no text to quote, so the model is told plainly what came with the turn and,
    // for a picture, that it cannot see the contents; it is never told it can see
    // something it cannot.
    const labelled = attached ? attached.name : '';
    const withFile = attached
      ? (attached.text
        ? [`Attached file: ${labelled}`, attached.text].join('\n\n')
        : unreadableFileNote(attached))
      : question;
    const withQuestion = attached && question !== '' ? `${question}\n\n${withFile}` : withFile;
    // The length the person picked rides with the question, the way the attachment
    // does. It is sent but not saved, so the transcript keeps only the words said.
    // A rewrite already names its own length ("Shorter"), so the picker's rule is left
    // out rather than sent beside it as a contradicting second instruction.
    const prompt = withQuestion === '' || rewrite
      ? withQuestion
      : `${withQuestion}\n\n${ANSWER_LENGTH_RULES[answerLength]}`;
    // What the bubble and the saved chat keep: the words, plus a line naming the
    // file. A link, where there is one, is stored beside the turn rather than
    // inside the words, so the thread draws a thumbnail instead of a long address.
    const said = attached
      ? (question === ''
        ? `[Attached file: ${labelled}]`
        : `${question}\n\n[Attached file: ${labelled}]`)
      : question;
    // Only an uploaded file becomes an attachment on the saved turn; a text file's
    // words are already in the message, so the account stores nothing extra. The
    // display address is left out on purpose: it carries this tab's session token,
    // and writing that into the account would be a leak. The bubble rebuilds it
    // from the path whenever the turn is drawn.
    const storedAttachment = attached?.url
      ? { url: attached.url, name: attached.name, kind: attached.kind, bytes: attached.size ?? attached.bytes ?? 0 }
      : null;

    const run = (runRef.current += 1);
    const conversationId = openId;
    const outgoing = [...thread.messages, { role: 'user', content: said }]
      .slice(-HISTORY_LIMIT)
      .map(({ role, content }) => ({ role, content }));
    // The question the model answers is the last turn, so it carries the file.
    outgoing[outgoing.length - 1] = { role: 'user', content: prompt };

    // A rewrite is about the answer above, not about what the composer holds, so the
    // desktop's behaviour is kept: a half-typed message and any file waiting to go
    // stay where they are. A fresh send takes them, as it always did.
    if (!rewrite) {
      setDraft('');
      setEnhancedFrom(null);
      setEnhanceNote('');
      setEnhanceSuggestions([]);
      setAttachment(null);
      setAttachNote('');
      clearChatDraft();
    }
    pendingFilesRef.current = [];
    resetReply();
    setStreaming(true);
    setThread((previous) => ({
      ...previous,
      messages: [...previous.messages, { role: 'user', content: said, attachment: storedAttachment }],
    }));
    atBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';

    try {
      /*
       * A picture model reads only words, so its turn is shaped differently: the
       * image endpoint draws one picture, which the account pays for out of the
       * same allowance. The picture joins the thread straight away and is filed in
       * the Images library; the saved chat keeps the sentence saying so, because a
       * conversation row holds words.
       */
      if (pictureModel) {
        setDrawing(true);
        const made = await api('/api/images', {
          method: 'POST',
          body: JSON.stringify({ prompt: question, model: pictureModel.code, shape: 'square', improve: true }),
        });
        const drawnBy = made?.modelName || pictureModel.name;
        let filed = '';
        try {
          await savePicture({
            blob: blobFromBase64(made.imageBase64, made.mime),
            prompt: question,
            usedPrompt: made.prompt ?? question,
            model: drawnBy,
            shape: 'square',
          });
          filed = ' It is saved in your Images library.';
        } catch {
          // A browser that refuses storage (private browsing) still shows the
          // picture; the sentence just does not promise it was kept.
        }
        if (run !== runRef.current) return;
        const note = `${drawnBy} drew this picture.${filed}`;
        setThread((previous) => ({
          ...previous,
          messages: [...previous.messages, {
            role: 'assistant',
            content: note,
            picture: `data:${made.mime};base64,${made.imageBase64}`,
          }],
        }));
        await saveExchange(conversationId, said, note, run, null, incognito);
        return;
      }

      /*
       * A chat model is offered one tool, a web search, and the rounds below are
       * the desktop app's own shape: ask, run what was asked for, hand the results
       * back, ask again. Only a chat model gets it, because a picture model reads
       * words and draws, so a search there would be paid for and thrown away.
       *
       * `wire` is the conversation as the server reads it. The person's turns go up
       * as they always did; each round's own assistant turn and its tool results
       * are added to that copy alone, because saveExchange keeps only the question
       * and the final answer.
       */
      const tools = pictureModel ? [] : [WEB_SEARCH_TOOL, DOCUMENT_TOOL, CREATE_TASK_TOOL, CREATE_REMINDER_TOOL, CREATE_AUTOMATION_TOOL, CREATE_MEMORY_TOOL];
      let wire = outgoing;
      let answer = '';
      let retriedEmpty = false;
      // One round past the cap, with no tools offered, so a model that keeps
      // reaching for the search still ends by answering in words.
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        // Stop ends the whole loop, which is why the signal is read between rounds
        // and not only by the request in flight.
        if (controller.signal.aborted) throw stoppedReply();
        // The closing round keeps the tools offered. Taking them away makes a model
        // write the call into its text instead, which is the markup nobody should
        // ever see, and the answer comes back empty. Offering them and asking for
        // words gets an answer that uses what the search already found.
        const closing = round === MAX_TOOL_ROUNDS && tools.length > 0;
        const offerTools = tools.length > 0 && !retriedEmpty;
        // Each round paints its own words, so a previous round's sentence does not
        // sit above the search that replaced it.
        reply = '';
        setStreamReply('');
        let result;
        try {
          result = await streamChat({
            messages: closing
              ? [...wire, { role: 'user', content: 'Answer now in plain words, using what you already have. Do not call another tool.' }]
              : wire,
            model,
            // A chat inside a project names it, so the server adds that project's
            // instructions and files to the prompt before the question is sent.
            projectId,
            tools: offerTools ? tools : [],
            signal: controller.signal,
            onDelta: (text) => {
              if (run !== runRef.current) return;
              reply += text;
              setStreamReply(reply);
              // Words have started arriving, so the search line is no longer the
              // only thing to say about this round.
              setToolStatus('');
            },
          });
        } catch (error) {
          if (error?.code !== 'CHAT_EMPTY_REPLY' || retriedEmpty) throw error;
          retriedEmpty = true;
          wire = [...wire, { role: 'user', content: EMPTY_REPLY_NUDGE }];
          continue;
        }
        if (run !== runRef.current) return;

        const content = result?.content || reply;
        const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
        const reasoningContent = typeof result?.reasoningContent === 'string' ? result.reasoningContent : '';
        // No calls, or a round that was not allowed to call anything: whatever came
        // back is the answer, streamed or handed over in one body.
        if (calls.length === 0 && content.trim() === '' && !retriedEmpty) {
          retriedEmpty = true;
          wire = [...wire, { role: 'user', content: EMPTY_REPLY_NUDGE }];
          continue;
        }
        if (calls.length === 0 || !offerTools) {
          answer = content;
          break;
        }

        // The model's turn goes back before its results, because that is the only
        // shape the server reads a tool result against.
        // reasoningContent goes back too: without it a reasoning model refuses the
        // round that carries the results, with "the reasoning_content in the thinking
        // mode must be passed back".
        wire = [...wire, {
          role: 'assistant',
          content,
          toolCalls: calls,
          ...(reasoningContent === '' ? {} : { reasoningContent }),
        }];
        for (const call of calls) {
          const outcome = await runToolCall(call, controller.signal, setToolStatus, (kind, record) => {
            const card = describeNotable(kind, record);
            if (card === null) return;
            if (kind === 'document') pendingFilesRef.current.push(record);
            setNotables((rows) => [...rows, { ...card, id: `${kind}-${rows.length}-${record?.id ?? record?.name ?? ''}`, file: kind === 'document' ? record : null, kept: kind === 'document' }]);
          });
          if (run !== runRef.current) return;
          wire = [...wire, {
            role: 'tool',
            toolCallId: typeof call?.id === 'string' ? call.id : '',
            content: outcome,
          }];
        }
      }
      setToolStatus('');

      if (!answer) {
        // On screen but not saved: an empty exchange is not worth a conversation row.
        setStreamError({ message: 'No reply arrived. Send that again when the connection is back.', status: 0 });
        setStreamReply('');
        return;
      }
      setThread((previous) => ({
        ...previous,
        messages: [...previous.messages, { role: 'assistant', content: answer }],
      }));
      setStreamReply('');
      await saveExchange(conversationId, said, answer, run, storedAttachment, incognito);
    } catch (error) {
      if (run !== runRef.current) return;
      // Stop, or a dropped connection, keeps what already arrived on screen: it
      // is readable, and the person can see where the reply stopped.
      if (reply) {
        setThread((previous) => ({
          ...previous,
          messages: [...previous.messages, { role: 'assistant', content: reply }],
        }));
      }
      setStreamReply('');
      setToolStatus('');
      if (error?.name !== 'AbortError') setStreamError(failureOf(error, pictureModel ? 'The picture could not be made.' : 'The reply could not be completed.'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      setDrawing(false);
      setToolStatus('');
    }
  }, [draft, streaming, openId, thread.messages, model, resetReply, saveExchange, projectId, pictureModel]);

  const editMessage = useCallback((message) => {
    const content = typeof message?.content === 'string' ? message.content : '';
    if (content.trim() === '' || streaming) return;
    setDraft(content);
    window.requestAnimationFrame(() => draftRef.current?.focus());
  }, [streaming]);

  const regenerateReply = useCallback(() => {
    if (streaming) return;
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index];
      if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim() !== '') {
        void send(message.content);
        return;
      }
    }
  }, [send, streaming, thread.messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const saveRename = useCallback(
    async (id) => {
      const title = renameDraft.trim();
      if (!title) return;
      try {
        const updated = await renameConversation(id, title);
        const next = updated?.title ?? title;
        setConversations((previous) => previous.map((item) => (item.id === id ? { ...item, title: next } : item)));
        if (openId === id) setThread((previous) => ({ ...previous, title: next }));
        setRenamingId(null);
        setRenameDraft('');
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be renamed.'));
      }
    },
    [renameDraft, openId],
  );

  const removeConversation = useCallback(
    async (id) => {
      try {
        await deleteConversation(id);
        void deleteFiles(id);
        setConversations((previous) => previous.filter((item) => item.id !== id));
        setConfirmId(null);
        if (openId === id) backToList();
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be deleted.'));
      }
    },
    [openId, backToList],
  );


  /**
   * Open the project list in a row's menu, reading it the first time.
   *
   * The list is fetched on demand rather than on mount: most visits to the chat
   * never move a chat, and a person with no projects should not pay a request for
   * every page load.
   */
  const openProjectPicker = useCallback(async (conversationId) => {
    setConfirmId(null);
    setProjectPickerFor(conversationId);
    if (projects.length > 0 || projectsStatus === 'loaded') return;
    setProjectsStatus('loading');
    try {
      const list = await fetchProjects();
      setProjects(list);
      setProjectsStatus('loaded');
    } catch (error) {
      setProjectsStatus('failed');
      setListError(failureOf(error, 'Your projects could not be loaded.'));
    }
  }, [projects.length, projectsStatus]);

  /**
   * File one chat into a project, or take it out with null.
   *
   * Inside a project the list is that project's own, so a chat moved somewhere else
   * has to leave it, exactly as an archived chat does. Filed from the whole history,
   * the row simply records where it now belongs.
   */
  const fileConversation = useCallback(
    async (conversation, targetProjectId) => {
      setFilingId(conversation.id);
      try {
        const updated = await setConversationProject(conversation.id, targetProjectId);
        setConversations((previous) => {
          const moved = previous.map((item) => (item.id === conversation.id ? { ...item, ...updated } : item));
          const nowInThisProject = String(updated?.projectId ?? '') === String(projectId ?? '');
          return nowInThisProject ? moved : moved.filter((item) => item.id !== conversation.id);
        });
        if (String(updated?.projectId ?? '') !== String(projectId ?? '') && openId === conversation.id) backToList();
        setProjectPickerFor(null);
        setRowMenuId(null);
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be moved into a project.'));
      } finally {
        setFilingId('');
      }
    },
    [backToList, openId, projectId],
  );

  /**
   * Move a chat in the list, the way ChatGPT's row menu does.
   *
   * Pinning and archiving are one call because they answer the same question,
   * where the chat belongs. The row is updated in place from the server's answer
   * rather than refetched, so the list does not flicker while it moves.
   */
  const moveConversation = useCallback(
    async (conversation, flags) => {
      try {
        const updated = await setConversationFlags(conversation.id, flags);
        setConversations((previous) => previous.map((item) => (item.id === conversation.id ? { ...item, ...updated } : item)));
        // A filed chat leaves the list, and the thread it was showing goes with it.
        if (flags.archived === true) {
          setConversations((previous) => previous.filter((item) => item.id !== conversation.id));
          if (openId === conversation.id) backToList();
        }
      } catch (error) {
        setListError(failureOf(error, 'That chat could not be moved.'));
      }
    },
    [openId, backToList],
  );
  const scrollToEnd = useCallback(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  const onMessagesScroll = useCallback(() => {
    const node = messagesRef.current;
    if (!node) return;
    // Reading further up is not interrupted: a new delta only follows the view
    // while the newest message is already in sight.
    atBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }, []);

  /**
   * Copy one message, the same affordance the desktop transcript has on both a
   * prompt and a reply. The confirmation clears itself, so the button returns to
   * "Copy" without a second click.
   * @param {{ role: string, content: string }} message
   * @param {number} index
   */
  const copyMessage = useCallback(async (message, index) => {
    const copied = await copyText(String(message?.content ?? ''));
    if (!copied) {
      setCopyNote('That message could not be copied to the clipboard.');
      return;
    }
    setCopyNote('');
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex((current) => (current === index ? -1 : current)), 1500);
  }, []);

  /** Read one reply aloud with the device's own voice, or stop if it is already being read. */
  const toggleSpeech = useCallback((message, index) => {
    if (speakingIndex === index) {
      stopSpeaking();
      setSpeakingIndex(-1);
      return;
    }
    const started = speak(String(message?.content ?? ''), {
      onEnd: () => setSpeakingIndex((current) => (current === index ? -1 : current)),
    });
    if (!started) {
      setCopyNote('This device has no voice available to read the reply aloud.');
      return;
    }
    setCopyNote('');
    setSpeakingIndex(index);
  }, [speakingIndex]);

  // Leaving the chat must not leave a voice talking.
  useEffect(() => () => stopSpeaking(), []);

  const shareMessage = useCallback(async (message) => {
    const content = String(message?.content ?? '').trim();
    if (!content) return;
    const result = await shareText({
      title: message?.role === 'assistant' ? "Zuri's reply" : 'My message',
      text: content,
    });
    if (result === 'shared') {
      setShareNote('');
      return;
    }
    const copied = await copyText(content);
    setShareNote(copied ? 'Sharing is not available here, so the message was copied.' : 'This message could not be shared.');
  }, []);

  const exportChat = useCallback(() => {
    if (thread.messages.length === 0) return;
    const title = String(thread.title || 'Zuri chat').trim() || 'Zuri chat';
    const text = thread.messages
      .map((message) => `${message.role === 'assistant' ? 'Zuri' : 'You'}:\n${String(message.content ?? '').trim()}`)
      .join('\n\n');
    const blob = new Blob([`# ${title}\n\n${text}\n`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'zuri-chat'}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [thread.messages, thread.title]);

  const showThread = Boolean(openId || composing);
  // Which pane a phone shows. An open chat always wins, so picking a conversation
  // puts it in front without clearing the list flag first.
  const pane = showThread || !listOpen ? 'thread' : 'list';
  const closeList = () => setListOpen(false);

  useEffect(() => {
    if (atBottomRef.current) scrollToEnd();
  }, [thread.messages, streamReply, threadStatus, scrollToEnd]);

  // Opening a chat puts the caret where the next action is.
  useEffect(() => {
    if (showThread) draftRef.current?.focus();
  }, [showThread, openId]);

  /*
   * The composer grows with the draft rather than scrolling inside a one-line box.
   * Its scrollbar is hidden, so without this a long message would scroll out of
   * sight instead of being readable. The desktop composer grows the same way and
   * caps at 192px; this one stops a little sooner because a phone has less height
   * to give the transcript.
   */
  useEffect(() => {
    const node = draftRef.current;
    if (!node) return;

    const fit = () => {
      // An empty draft needs no measurement: dropping the inline height hands the
      // field back to its one-line floor, so clearing a long draft returns the
      // composer to exactly the height it opened at.
      if (node.value === '') {
        node.style.height = '';
        return;
      }

      // The one-line floor is lifted for the measurement: with it in place the box
      // cannot resolve to its content height, and scrollHeight would report the
      // floor instead of the text, leaving the field a line too tall.
      const floor = node.style.minHeight;
      node.style.minHeight = '0';
      node.style.height = 'auto';
      // scrollHeight already covers the field's own padding, so adding it again made
      // an empty box 18px taller than one line. Measured as it is, one line of text
      // is exactly one line of box.
      const measured = node.scrollHeight;
      node.style.minHeight = floor;
      // The field grows with the typing rather than stopping at a fixed number of
      // lines and starting to scroll. The only ceiling is the room the window has:
      // past that the composer would push the conversation off the screen.
      const ceiling = Math.max(120, Math.round(window.innerHeight * 0.45));
      node.style.height = `${Math.min(measured, ceiling)}px`;
      // A paste longer than the ceiling still scrolls, but silently: the bar is a
      // second control in the middle of the composer and there is nothing to point
      // at, so it is hidden rather than shown.
      node.style.overflowY = measured > ceiling ? 'auto' : 'hidden';
    };

    // Measured after layout: a box that has just mounted reports no content height,
    // which would leave the field one line short of its own placeholder.
    const frame = window.requestAnimationFrame(fit);
    // How much text fits on a line depends on the box's width, and that width changes
    // between a phone and a desktop and when the buttons beside it change. Watching the
    // width keeps a restored draft readable instead of clipping its second line before
    // the first keystroke. The first callback lands after layout, so it also corrects a
    // measurement taken too early.
    let lastWidth = 0;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const width = node.getBoundingClientRect().width;
          if (Math.abs(width - lastWidth) < 1) return;
          lastWidth = width;
          fit();
        })
      : null;
    observer?.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
    // showThread is a dependency because the field is not on screen until it is true.
  }, [draft, showThread]);

  /*
   * One picker for everything Zuri can make, so the picture models come from the
   * catalogue the Images page uses. A model the plan leaves out stays in the list,
   * greyed with the plan it needs: hiding it would let the picker look like the
   * whole story.
   *
   * /api/models is asked first because it answers with this account's own
   * availability, but it refuses anyone who is not on a paid plan, which left the
   * picture list empty for most people. The public price list carries no such
   * check, so it answers when the first route lists nothing, and an empty list is
   * what is left when both of them fail.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      let pictures = [];
      try {
        const listed = await api('/api/models');
        pictures = Array.isArray(listed) ? listed.filter((entry) => entry.kind === 'image') : [];
      } catch {
        // A refusal is the expected answer for an account on no paid plan, and it
        // is not the end of the list: the fallback below still knows every model.
        pictures = [];
      }
      if (pictures.length === 0) {
        // This view is not handed the account's plan, so the helper is asked
        // without one: it then marks every model available, and the server still
        // refuses a model the plan leaves out when a picture is actually asked for.
        try {
          const catalogue = await fetchPictureModels('');
          pictures = Array.isArray(catalogue) ? catalogue : [];
        } catch {
          pictures = [];
        }
      }
      if (active) setPictureModels(pictures);
    })();
    return () => { active = false; };
  }, []);

  const onComposerKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An IME pick can arrive as Enter; that is text, not a send.
    if (event.nativeEvent?.isComposing) return;
    event.preventDefault();
    send();
  };

  const sessionExpired = listError?.status === 401 || threadError?.status === 401 || streamError?.status === 401;
  // The phone row is short, so the label drops its "Zuri" prefix there rather than
  // disappearing: an unlabelled chevron does not say which model will answer.
  const modelShortName = modelName.replace(/^Zuri\s+/, '');
  // The newest reply carries the caption, as the desktop transcript does: repeating
  // the model above every bubble would say the same thing down the whole page.
  const lastAnswerIndex = thread.messages.reduce((last, message, index) => (message.role === 'assistant' ? index : last), -1);

  return (
    <section className="chat-workspace" data-pane={pane}>
      {/*
        * The saved chats, drawn the way the desktop app's chat sidebar draws them:
        * a Recents label, then one quiet row per thread. Starting a chat is the Chat
        * destination's own job, so the column carries no second button for it. On a
        * phone this pane slides over the thread, which is how ChatGPT treats the
        * same list, and the thread keeps its own back control.
        */}
      <aside className={`chat-recents${navCollapsed ? ' is-collapsed' : ''}`} aria-label="Saved chats">
        {/* On a phone this column covers the chat, so it carries the way back to it.
            The shared navigation panel's own close control is hidden here in CSS,
            because this one closes the list rather than the drawer. */}
        <div className="chat-list-head">
          <IconButton label="Close saved chats" onClick={closeList}>
            <CloseIcon size={18} aria-hidden="true" />
          </IconButton>
        </div>
        {/* The same navigation panel the other pages show, so a chat has one sidebar
            holding both the destinations and the conversations. */}
        {navigation && <div className="chat-nav">{navigation}</div>}

        {/* Inside a project the list is that project's own, so it says which one and
            offers the way back to the projects screen. Without this a person could not
            tell the project history from the whole history. */}
        {projectId !== '' && (
          <div className="chat-project">
            <span className="chat-project-name">
              <FolderIcon size={16} aria-hidden="true" />
              {projectName === '' ? 'This project' : projectName}
            </span>
            {onLeaveProject && (
              <Button variant="ghost" className="chat-project-leave" onClick={onLeaveProject}>
                All chats
              </Button>
            )}
          </div>
        )}

        {/* The list's own heading, with the way to the archived chats at its end.
            The rows below are only the live ones, so the history needs a door. Inside
            a project the same list holds that project's chats, so it is not Recents. */}
        <div className="chat-recents-head">
          <p className="chat-recents-head-title">{projectId === '' ? 'Recents' : 'Chats'}</p>
          <IconButton label="Chat history" onClick={() => onOpenHistory()}>
            <HistoryIcon size={16} aria-hidden="true" />
          </IconButton>
        </div>

        <ConversationSearch
          value={conversationQuery}
          onChange={setConversationQuery}
          onClear={() => setConversationQuery('')}
        />

        <div className="chat-recents-list">
          {listStatus === 'loading' && <p className="chat-recents-empty">Loading your chats...</p>}
          {listStatus !== 'loading' && conversations.length === 0 && (
            <p className="chat-recents-empty">
              {conversationQuery.trim() === ''
                ? 'No saved chats yet. Your first question appears here.'
                : 'No chats match that search.'}
            </p>
          )}

          {withGroupHeadings(conversations, conversationQuery.trim() !== '').map(({ conversation, heading }) => (
            <div key={conversation.id} data-group={heading || undefined} className={`chat-recent${conversation.id === openId ? ' is-active' : ''}`}>
              {renamingId === conversation.id ? (
                <form
                  className="chat-recent-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename(conversation.id);
                  }}
                >
                  <Input
                    className="chat-recent-input"
                    aria-label="Chat name"
                    maxLength={120}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    autoFocus
                  />
                  <IconButton type="submit" size="sm" label="Save name" isDisabled={renameDraft.trim() === ''}>
                    <CheckIcon size={14} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Cancel renaming"
                    onClick={() => { setRenamingId(null); setRenameDraft(''); }}
                  >
                    <CloseIcon size={14} aria-hidden="true" />
                  </IconButton>
                </form>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="chat-recent-open"
                    onClick={() => void openConversation(conversation.id)}
                    aria-current={conversation.id === openId ? 'page' : undefined}
                    title={conversation.title || 'New chat'}
                  >
                    <span className="chat-recent-title">
                      {conversation.pinned && <PinIcon size={12} filled aria-hidden="true" />}
                      {conversation.title || 'New chat'}
                    </span>
                    <span className="chat-recent-line">
                      <span className="chat-recent-snippet">{previewOf(conversation)}</span>
                      <span className="chat-recent-meta">{formatRelativeTime(stamp(conversation) || undefined)}</span>
                    </span>
                  </Button>
                  <span className="chat-recent-actions">
                    {/*
                      * One control per row, as ChatGPT draws it: the actions appear in a
                      * menu rather than sitting on the row. Four icons beside a title
                      * left no room for the title itself, and a row is read far more
                      * often than it is acted on.
                      */}
                    <IconButton
                      size="sm"
                      label={`Actions for ${conversation.title || 'chat'}`}
                      aria-expanded={rowMenuId === conversation.id}
                      onClick={() => { setRowMenuId(rowMenuId === conversation.id ? null : conversation.id); setConfirmId(null); }}
                    >
                      <MoreIcon size={14} aria-hidden="true" />
                    </IconButton>
                    {rowMenuId === conversation.id && projectPickerFor === conversation.id && (
                      <div className="chat-row-menu chat-row-menu-projects" role="menu" aria-label="Move this chat to a project">
                        <MenuBack
                          onBack={() => {
                            setProjectPickerFor(null);
                            setRowMenuId(null);
                          }}
                        >
                          Move to project
                        </MenuBack>
                        {projectsStatus === 'loading' && <p className="chat-menu-note">Reading your projects...</p>}
                        {filingId === conversation.id && <p className="chat-menu-note">Moving this chat...</p>}
                        {projectsStatus === 'failed' && <p className="chat-menu-note">Your projects could not be loaded.</p>}
                        {projectsStatus === 'loaded' && projects.length === 0 && (
                          <p className="chat-menu-note">No projects yet. Make one on the Projects page.</p>
                        )}
                        {projects.map((project) => (
                          <MenuItem
                            key={project.id}
                            role="menuitemradio"
                            checked={String(conversation.projectId ?? '') === String(project.id)}
                            onSelect={() => void fileConversation(conversation, project.id)}
                          >
                            <FolderIcon size={14} aria-hidden="true" />
                            <span className="chat-menu-label">{project.name || 'Untitled project'}</span>
                            {String(conversation.projectId ?? '') === String(project.id) && <CheckIcon size={14} aria-hidden="true" />}
                          </MenuItem>
                        ))}
                        {String(conversation.projectId ?? '') !== '' && (
                          <MenuItem
                            role="menuitemradio"
                            checked={false}
                            onSelect={() => void fileConversation(conversation, null)}
                          >
                            <CloseIcon size={14} aria-hidden="true" />
                            Take out of its project
                          </MenuItem>
                        )}
                      </div>
                    )}
                    {rowMenuId === conversation.id && projectPickerFor !== conversation.id && (
                      <div className="chat-row-menu" role="menu">
                        <MenuItem onSelect={() => { setRowMenuId(null); setRenamingId(conversation.id); setRenameDraft(conversation.title ?? ''); }}>
                          <EditIcon size={14} aria-hidden="true" />
                          Rename
                        </MenuItem>
                        <MenuItem onSelect={() => void openProjectPicker(conversation.id)}>
                          <FolderIcon size={14} aria-hidden="true" />
                          {conversation.projectId ? 'Move to another project' : 'Move to project'}
                        </MenuItem>
                        <MenuItem onSelect={() => { setRowMenuId(null); void moveConversation(conversation, { pinned: !conversation.pinned }); }}>
                          <PinIcon size={14} filled={conversation.pinned === true} aria-hidden="true" />
                          {conversation.pinned ? 'Unpin' : 'Pin to top'}
                        </MenuItem>
                        <MenuItem onSelect={() => { setRowMenuId(null); void moveConversation(conversation, { archived: true }); }}>
                          <ArchiveIcon size={14} aria-hidden="true" />
                          Archive
                        </MenuItem>
                        <MenuItem
                          className={confirmId === conversation.id ? 'is-danger' : ''}
                          onSelect={() => {
                            // Deleting takes two choices: the first arms the item, the
                            // second removes the chat, so one stray press cannot lose one.
                            if (confirmId === conversation.id) { setRowMenuId(null); void removeConversation(conversation.id); }
                            else setConfirmId(conversation.id);
                          }}
                        >
                          <DeleteIcon size={14} aria-hidden="true" />
                          {confirmId === conversation.id ? 'Confirm delete' : 'Delete'}
                        </MenuItem>
                      </div>
                    )}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        <p className="chat-recents-foot">Every chat here is saved to your account.</p>
      </aside>

      <main className="chat-thread">
        {/*
          * Two bare floating icons, as the desktop chat draws them, rather than a
          * header bar: the chat list on the left (or the back control on a phone) and
          * starting a new chat on the right. The transcript scrolls underneath them.
          */}
        <div className="chat-floats">
          {/* A phone can hold only one pane, so this corner always carries the way
              back to the list, even from the opening state with nothing open. A wide
              screen keeps the list beside the thread and hides the button in CSS. */}
          <IconButton
            label="Open menu"
            className="chat-back"
            onClick={backToList}
          >
            <PanelLeftOpenIcon size={18} aria-hidden="true" />
          </IconButton>
          <div className="chat-floats-end">
            <IconButton label="New chat" onClick={startNewChat}>
              <PlusIcon size={18} aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div ref={messagesRef} onScroll={onMessagesScroll} className="chat-transcript">
          {!showThread && (
            <div className="chat-opening">
              <span className="chat-opening-mark"><LogoMark size={52} /></span>
              <h2>{greetingFor(userName)}</h2>
            </div>
          )}

          {showThread && threadStatus === 'loading' && <p className="chat-empty">Loading messages...</p>}

          {showThread && threadStatus !== 'loading' && thread.messages.length === 0 && !streaming && (
            <div className="chat-opening">
              <span className="chat-opening-mark"><LogoMark size={52} /></span>
              <h2>{greetingFor(userName)}</h2>
            </div>
          )}

          {thread.messages.map((message, index) => (
            <Fragment key={`${index}-${message.role}`}>
              {/* The desktop prints the model above the reply, outside the bubble. */}
              {message.role === 'assistant' && index === lastAnswerIndex && (
                <span className="chat-bubble-role">{modelName}</span>
              )}
              <div className={`chat-turn chat-turn-${message.role}`}>
              <article className={`chat-bubble chat-bubble-${message.role}`}>
                {/* A prompt is shown exactly as typed. A reply goes through the desktop's
                    own renderer, so code, lists, tables and links read the same on both. */}
                {message.attachment && (
                  // The file is kept by this account's own server. The address an
                  // image tag can load carries the token in its query string,
                  // because an <img> cannot send the Authorization header, and a
                  // turn loaded from the account holds only the plain path, so
                  // fileAddress() completes it here. The link opens that same
                  // address: the bare path would be refused without the header.
                  // A picture is drawn small enough to keep the thread readable; a
                  // PDF is a named row, because a page thumbnail would mean
                  // rendering the file to make a picture of a picture.
                  message.attachment.kind?.startsWith('image/') ? (
                    <a className="chat-attachment" href={fileAddress(message.attachment)} target="_blank" rel="noopener noreferrer">
                      <img src={fileAddress(message.attachment)} alt={message.attachment.name} loading="lazy" decoding="async" />
                      <span>{message.attachment.name}</span>
                    </a>
                  ) : (
                    <a className="chat-attachment is-file" href={fileAddress(message.attachment)} target="_blank" rel="noopener noreferrer">
                      <FileIcon size={ICON_SIZE.lg} />
                      <span>{message.attachment.name}</span>
                    </a>
                  )
                )}
                {message.role === 'assistant'
                  ? (
                    <>
                      {message.picture && (
                        <img className="chat-picture" src={message.picture} alt={message.content} decoding="async" />
                      )}
                      <div className="chat-answer"><FormattedMessage content={message.content} /></div>
                    </>
                  )
                  : <p className="chat-text">{message.content}</p>}
              </article>
                <div className="chat-bubble-actions">
                  {message.role === 'user' && (
                    <IconButton
                      size="sm"
                      className="chat-edit"
                      label="Edit and send again"
                      onClick={() => editMessage(message)}
                    >
                      <EditIcon size={14} aria-hidden="true" />
                    </IconButton>
                  )}
                  {message.role === 'assistant' && index === lastAnswerIndex && (
                    <IconButton
                      size="sm"
                      className="chat-regenerate"
                      label="Regenerate reply"
                      onClick={regenerateReply}
                    >
                      <RegenerateIcon size={14} aria-hidden="true" />
                    </IconButton>
                  )}
                  <IconButton
                    size="sm"
                    className="chat-copy"
                    label={copiedIndex === index ? 'Copied' : message.role === 'user' ? 'Copy your message' : "Copy Zuri's reply"}
                    onClick={() => void copyMessage(message, index)}
                  >
                    {copiedIndex === index ? <CheckIcon size={14} aria-hidden="true" /> : <CopyIcon size={14} aria-hidden="true" />}
                  </IconButton>
                  {message.role === 'assistant' && speechAvailable() && (
                    <IconButton
                      size="sm"
                      className="chat-speak"
                      label={speakingIndex === index ? 'Stop reading aloud' : "Read Zuri's reply aloud"}
                      onClick={() => toggleSpeech(message, index)}
                    >
                      {speakingIndex === index ? <StopIcon size={14} aria-hidden="true" /> : <SpeakIcon size={14} aria-hidden="true" />}
                    </IconButton>
                  )}
                  {/*
                    * The same four rewrites the desktop shows under its newest reply, in
                    * the desktop's order: the icon actions first, the words after them.
                    * Each sends a short follow-up in this chat instead of editing the
                    * answer, so the earlier version stays on screen to compare against,
                    * and the request reads as something the person said.
                    *
                    * A picture reply is drawn by an image model, not written by the chat
                    * model, so rewriting it would swap the picture for words. A picture
                    * model in the composer is left out for the same reason: its turn
                    * would draw a new image instead of rewriting the words above.
                    */}
                  {message.role === 'assistant' && index === lastAnswerIndex && !streaming && !pictureModel && !message.picture && QUICK_ADJUSTMENTS.map((adjustment) => (
                    <Button
                      key={adjustment.label}
                      type="button"
                      variant="ghost"
                      className="chat-quick-adjust"
                      title={`Rewrite: ${adjustment.label}`}
                      aria-label={`Rewrite: ${adjustment.label}`}
                      onClick={() => void send(adjustment.text, { rewrite: true })}
                    >
                      {adjustment.label}
                    </Button>
                  ))}
                  <IconButton
                    size="sm"
                    className="chat-share"
                    label="Share message"
                    onClick={() => void shareMessage(message)}
                  >
                    <ShareIcon size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </Fragment>
          ))}

          {notables.length > 0 && (
            <div className="chat-notables">
              {notables.map((card) => (
                <div className="zuri-notable" key={card.id}>
                  <div className="zuri-notable-head">
                    <span className="zuri-notable-badge">
                      <span className="zuri-notable-check" aria-hidden="true">&#10003;</span>
                      {card.badge}
                    </span>
                  </div>
                  <p className="zuri-notable-title">{card.title}</p>
                  {card.file && (
                    <Button variant="secondary" onClick={() => saveGeneratedFile(card.file)}>Download</Button>
                  )}
                  {card.lines.length > 0 && (
                    <dl className="zuri-notable-lines">
                      {card.lines.map((line, lineIndex) => (
                        <div className="zuri-notable-line" key={`${line.label}-${lineIndex}`}>
                          <dt>{line.label}</dt>
                          <dd>{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}

          {streaming && (
            <article className="chat-bubble chat-bubble-assistant is-streaming">
              {/* The search round is the one wait with nothing to read, so it says
                  what it is doing rather than leaving the bubble empty. */}
              {streamReply
                ? <div className="chat-answer"><FormattedMessage content={streamReply} /></div>
                : <p className="chat-text">{drawing ? 'Zuri is drawing your picture...' : (toolStatus || 'Zuri is thinking...')}</p>}
              {streamReply !== '' && toolStatus !== '' && <p className="chat-text chat-note">{toolStatus}</p>}
            </article>
          )}
        </div>

        <div className="chat-composer-wrap">
          {sessionExpired && (
            <InlineAlert tone="danger">
              Your session expired. Sign in again to reach your saved chats.
              {onSignIn && (
                <Button variant="secondary" className="chat-alert-action" onClick={onSignIn}>
                  Sign in
                </Button>
              )}
            </InlineAlert>
          )}
          {listError && !sessionExpired && <InlineAlert tone="danger">{listError.message}</InlineAlert>}
          {threadError && !sessionExpired && <InlineAlert tone="danger">{threadError.message}</InlineAlert>}
          {streamError && <InlineAlert tone="danger">{streamError.message}</InlineAlert>}
          {saveWarning !== '' && <p className="chat-note">{saveWarning}</p>}
          {incognito && <p className="chat-note">Incognito chat: this conversation is not saved to your account.</p>}
          {copyNote !== '' && <p className="chat-note is-error">{copyNote}</p>}
          {shareNote !== '' && <p className="chat-note">{shareNote}</p>}
          {attachNote !== '' && <p className="chat-note is-error">{attachNote}</p>}
          {enhanceNote !== '' && <p className="chat-note is-error">{enhanceNote}</p>}
          {enhanceSuggestions.length > 0 && (
            // What the enhancer thought was missing. Each line is a press away from
            // joining the message, so the person takes only what is true for them.
            <div className="chat-suggestions" role="group" aria-label="Suggested additions to your prompt">
              <p className="chat-suggestions-title">Add to your prompt</p>
              {enhanceSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="ghost"
                  className="chat-suggestion"
                  onClick={() => addSuggestion(suggestion)}
                >
                  <PlusIcon size={14} aria-hidden="true" />
                  <span>{suggestion}</span>
                </Button>
              ))}
            </div>
          )}
          {attachment && (
            // The file waiting to go. A picture is drawn as itself, so a phone user
            // sees what they picked before sending instead of a name they have to
            // trust; a PDF or a text file keeps the named row.
            <div className="chat-attachment is-pending">
              {String(attachment.kind ?? '').startsWith('image/') ? (
                <img
                  className="chat-attachment-thumb"
                  src={fileAddress(attachment)}
                  alt={attachment.name}
                  decoding="async"
                />
              ) : (
                <PaperclipIcon size={14} aria-hidden="true" />
              )}
              <span className="chat-attachment-name" title={attachment.name}>{attachment.name}</span>
              <span className="chat-attachment-meta">
                {/* Said plainly: the words of a text file travel inside the
                    message, while a picture or a PDF is kept by this account's
                    own file store and sent as a link. */}
                sent with this message
              </span>
              <IconButton
                size="sm"
                label="Remove attached file"
                onClick={() => { setAttachment(null); setAttachNote(''); }}
              >
                <CloseIcon size={14} aria-hidden="true" />
              </IconButton>
            </div>
          )}

          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {/* The desktop composer leads with an add control, so the web one does too:
                a file, a picture, a reply length or a starter sentence, each acted on
                here rather than sent to another screen. */}
            <div ref={menuRef} className="relative">
              <IconButton
                className="chat-attach"
                label="Add to message"
                title="Add a file, a reply length or a command"
                aria-haspopup="menu"
                aria-expanded={menuView !== ''}
                onClick={() => setMenuView((current) => (current === '' ? 'main' : ''))}
              >
                <PlusIcon size={18} aria-hidden="true" />
              </IconButton>
              {menuView !== '' && (
                <div
                  role="menu"
                  aria-label="Add to message"
                  className="chat-menu"
                >
                  {menuView === 'main' ? (
                    <>
                      <MenuItem onSelect={() => pickMenuItem(() => fileRef.current?.click())}>
                        <PaperclipIcon size={16} aria-hidden="true" />
                        <span>Attach a file</span>
                      </MenuItem>
                      {/* The same entry the desktop add menu carries, so a picture is
                          started from the composer rather than from another screen. */}
                      <MenuItem onSelect={() => setMenuView('picture')}>
                        <ImageIcon size={16} aria-hidden="true" />
                        <span className="flex-1">Draw a picture</span>
                        {pictureModel && (
                          <span className="text-xs text-[var(--muted)]">{pictureModel.name}</span>
                        )}
                      </MenuItem>
                      <MenuItem onSelect={() => setMenuView('length')}>
                        <AlignLeftIcon size={16} aria-hidden="true" />
                        <span className="flex-1">Reply length</span>
                        <span className="text-xs capitalize text-[var(--muted)]">{answerLength}</span>
                      </MenuItem>
                      <MenuItem onSelect={() => setMenuView('commands')}>
                        <CommandIcon size={16} aria-hidden="true" />
                        <span>Slash commands</span>
                      </MenuItem>
                      <MenuItem onSelect={() => pickMenuItem(() => {
                        if (!incognito) startNewChat();
                        setIncognito((current) => !current);
                      })}>
                        <span aria-hidden="true" className="chat-menu-slot" />
                        <span className="flex-1">{incognito ? 'Turn off incognito chat' : 'Start incognito chat'}</span>
                        {incognito && <CheckIcon size={16} aria-hidden="true" />}
                      </MenuItem>
                      <MenuItem disabled={thread.messages.length === 0} onSelect={() => pickMenuItem(exportChat)}>
                        {/* Nothing to show in the icon column, so it keeps the empty
                            slot rather than starting a column to the left. */}
                        <span aria-hidden="true" className="chat-menu-slot" />
                        <span>Export chat</span>
                      </MenuItem>
                    </>
                  ) : menuView === 'length' ? (
                    <>
                      <MenuBack onBack={() => setMenuView('main')}>Reply length</MenuBack>
                      {ANSWER_LENGTH_CHOICES.map(([value, label, hint]) => (
                        <MenuItem
                          key={value}
                          role="menuitemradio"
                          checked={answerLength === value}
                          onSelect={() => pickMenuItem(() => setAnswerLength(value))}
                        >
                          <span aria-hidden="true" className="chat-menu-slot" />
                          <span className="flex-1">{label}</span>
                          <span className="text-xs text-[var(--muted)]">{hint}</span>
                          {answerLength === value && <CheckIcon size={16} aria-hidden="true" />}
                        </MenuItem>
                      ))}
                    </>
                  ) : menuView === 'picture' ? (
                    <>
                      <MenuBack onBack={() => setMenuView('main')}>Draw a picture</MenuBack>
                      {pictureModels.length === 0 ? (
                        <p className="chat-menu-note">The picture models could not be loaded.</p>
                      ) : (
                        pictureModels.map((entry) => (
                          <MenuItem
                            key={entry.code}
                            role="menuitemradio"
                            checked={model === entry.code}
                            disabled={!entry.available}
                            title={entry.available ? `Draws a picture with ${entry.name}` : `${entry.name} needs the ${entry.minPlan} plan`}
                            onSelect={() => {
                              setModel(entry.code);
                              setMenuView('');
                            }}
                          >
                            <span aria-hidden="true" className="chat-menu-slot" />
                            <span className="flex-1">{entry.name}</span>
                            {entry.available
                              ? (model === entry.code && <CheckIcon size={16} aria-hidden="true" />)
                              : <span className="chat-model-plan">{entry.minPlan}</span>}
                          </MenuItem>
                        ))
                      )}
                    </>
                  ) : (
                    <>
                      <MenuBack onBack={() => setMenuView('main')}>Slash commands</MenuBack>
                      {SLASH_COMMANDS.map((command) => (
                        <MenuItem key={command.label} onSelect={() => pickMenuItem(() => insertCommand(command.text))}>
                          <span>{command.label}</span>
                        </MenuItem>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              className="chat-file-input"
              aria-label="Attach a file"
              accept=".txt,.text,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sql,.xml,image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(event) => void chooseAttachment(event)}
            />
            <TextArea
              ref={draftRef}
              className="chat-input"
              rows={1}
              value={draft}
              placeholder={pictureModel ? 'Describe the picture to draw' : 'Ask Zuri anything'}
              aria-label="Message"
              onChange={(event) => {
                setDraft(event.target.value);
                // Editing by hand ends the undo, or restoring would discard the edit.
                if (enhancedFrom !== null) setEnhancedFrom(null);
                if (enhanceNote !== '') setEnhanceNote('');
              }}
              onKeyDown={onComposerKeyDown}
            />

            {/* The model chip sits beside Send, exactly as the desktop composer places
                it, and names the model that will answer this chat. */}
            <div ref={modelMenuRef} className="chat-model-slot">
              <Button
                type="button"
                variant="ghost"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                aria-label={`Model: ${modelName}`}
                title="Choose the model that answers"
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span className="chat-model-label">
                  <span className="chat-model-label-full">{modelName}</span>
                  <span className="chat-model-label-short">{modelShortName}</span>
                </span>
                <ChevronUpIcon
                  size={16}
                  aria-hidden="true"
                  className={`chat-model-chevron${modelMenuOpen ? ' is-open' : ''}`}
                />
              </Button>
              {modelMenuOpen && (
                <div role="menu" aria-label="Choose a model" className="chat-model-menu">
                  {CHAT_MODELS.map((entry) => (
                    <MenuItem
                      key={entry.code}
                      role="menuitemradio"
                      checked={model === entry.code}
                      onSelect={() => {
                        setModel(entry.code);
                        setModelMenuOpen(false);
                      }}
                    >
                      <span className="chat-model-name">{entry.name}</span>
                      {model === entry.code && <CheckIcon size={14} aria-hidden="true" />}
                    </MenuItem>
                  ))}
                  {/* The picture models close the same list. One Zuri can make words
                      and pictures, so the picker does not send anyone to a second
                      screen to find the other half of it. */}
                  {pictureModels.length > 0 && (
                    <>
                      <p className="chat-model-group" role="presentation">Pictures</p>
                      {pictureModels.map((entry) => (
                        <MenuItem
                          key={entry.code}
                          role="menuitemradio"
                          checked={model === entry.code}
                          disabled={!entry.available}
                          title={entry.available ? `Draws a picture with ${entry.name}` : `${entry.name} needs the ${entry.minPlan} plan`}
                          onSelect={() => {
                            setModel(entry.code);
                            setModelMenuOpen(false);
                          }}
                        >
                          <span className="chat-model-name">{entry.name}</span>
                          {entry.available
                            ? (model === entry.code && <CheckIcon size={14} aria-hidden="true" />)
                            : <span className="chat-model-plan">{entry.minPlan}</span>}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Beside Send: one press rewrites the message box into a clearer prompt,
                and a second puts the person's own words back before it is sent. */}
            <IconButton
              type="button"
              label={enhancedFrom !== null ? 'Undo the improved prompt' : 'Improve the prompt'}
              className={`chat-enhance${enhancedFrom !== null ? ' is-active' : ''}`}
              isDisabled={enhancing || draft.trim() === ''}
              onClick={enhance}
            >
              <EnhanceIcon size={18} aria-hidden="true" className={enhancing ? 'is-busy' : ''} />
            </IconButton>

            {streaming ? (
              <IconButton label="Stop reply" className="chat-send" onClick={stop}>
                <StopIcon size={14} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton type="submit" label="Send" className="chat-send" isDisabled={draft.trim() === '' && !attachment}>
                <SendIcon size={18} aria-hidden="true" />
              </IconButton>
            )}
          </form>
        </div>
      </main>
    </section>
  );
}
