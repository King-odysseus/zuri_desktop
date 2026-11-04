/**
 * automations.js - scheduled prompts the service runs on its own.
 *
 * Why this exists on the server: the desktop app already has a scheduler, but it
 * only fires while that computer is awake with Zuri open, so "check for new jobs
 * each morning and tell me" never happened on a laptop that was shut, and never
 * happened at all on a phone. A row in the automations table is run by this
 * service, so the answer is waiting whatever the person's own machine was doing.
 *
 * The shape of one run is deliberately narrow. An automation runs with nobody
 * watching, so it is offered exactly one tool, webSearch, and no tool that writes
 * anything: there is no one there to approve a change to a file or a payment, and a
 * run that could only read is a run that cannot be regretted. It also gets its own
 * instruction to answer in full rather than ask a question, because a question
 * asked at 07:00 to an empty room is a wasted run.
 *
 * Everything that decides *when* something runs is a pure function over an explicit
 * clock (checkedCadence, firstRunAt, nextRunAfter), which is what lets the project's
 * checks drive a year of schedules without waiting for real time to pass. The
 * database, the AI provider, the search engine and the mailer are all injected, for
 * the same reason.
 */

import {
  ANSWER_RULES,
  RESEARCH_RULES,
  ZURI_IDENTITY,
  plainDashes,
} from './text.js';
import {
  DEFAULT_MODEL_CODE,
  findModel,
  limitsForModel,
  quotaTokens,
  supplierCostMicroUsd,
} from './models.js';
import { limitsForPlan } from './limits.js';
import { splitToolCalls } from './markup.js';

/** Said once to a run whose round came back with nothing to read and nothing to run. */
const EMPTY_ROUND_NOTE = 'Your previous reply had no words in it. Write the answer now in plain words. You have no tools in this reply: do not search, and do not write any tool request in any form.';

/** The three rules an automation can carry. Anything else is not a schedule. */
export const CADENCE_TYPES = Object.freeze(['once', 'daily', 'interval']);

/** The floor on an interval, so one automation cannot become a busy loop. */
export const MIN_INTERVAL_MINUTES = 15;
/** A week. Past this an interval is better expressed as a daily time. */
export const MAX_INTERVAL_MINUTES = 10080;

/** How many searches one run may make, and how many model rounds it may take. */
export const MAX_SEARCHES_PER_RUN = 4;
export const MAX_ROUNDS_PER_RUN = 6;

/** How long one whole run may take before it is abandoned. */
const RUN_TIMEOUT_MS = 180_000;
/** How long a usage reservation is held for one round. */
const RESERVATION_TTL_MS = 5 * 60 * 1000;
/** How often the sweep looks for due work. */
export const DEFAULT_SWEEP_MS = 60_000;
/** How many automations one sweep may take, so a backlog is worked through steadily. */
const SWEEP_BATCH = 10;

/** 'HH:MM' on a 24 hour clock. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** @param {unknown} value @returns {string} */
function words(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read and check a cadence from a request or a tool call.
 *
 * Every rule needs the one value that makes it a rule, so a daily cadence with no
 * time and an interval with no gap are refused here rather than stored as a row that
 * could never be scheduled. This mirrors how the reminder route checks its repeat.
 * @param {unknown} input
 * @returns {{ ok: true, type: string, intervalMinutes: number|null, timeOfDay: string|null, at: string|null } | { ok: false, code: string, message: string }}
 */
export function checkedCadence(input) {
  const source = input !== null && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {};
  const type = words(source.type).toLowerCase() || 'daily';
  if (!CADENCE_TYPES.includes(type)) {
    return { ok: false, code: 'AUTOMATION_CADENCE_INVALID', message: 'Say how often this runs: once, daily or interval.' };
  }

  if (type === 'interval') {
    const minutes = Math.trunc(Number(source.minutes));
    if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
      return {
        ok: false,
        code: 'AUTOMATION_INTERVAL_INVALID',
        message: `Give the interval in whole minutes, between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`,
      };
    }
    return { ok: true, type, intervalMinutes: minutes, timeOfDay: null, at: null };
  }

  if (type === 'daily') {
    const timeOfDay = words(source.timeOfDay);
    if (!TIME_OF_DAY.test(timeOfDay)) {
      return { ok: false, code: 'AUTOMATION_TIME_INVALID', message: 'Give the daily time as HH:MM on a 24 hour clock, for example 07:30.' };
    }
    return { ok: true, type, intervalMinutes: null, timeOfDay, at: null };
  }

  const at = words(source.at);
  const when = new Date(at);
  if (at === '' || Number.isNaN(when.getTime())) {
    return { ok: false, code: 'AUTOMATION_AT_INVALID', message: 'Give the date and time to run, for example 2026-11-02T09:00:00Z.' };
  }
  return { ok: true, type, intervalMinutes: null, timeOfDay: null, at: when.toISOString() };
}

/**
 * The next whole occurrence of a daily time, strictly after `from`.
 *
 * The time is read as UTC, because that is the only clock this service has: a row
 * holds 'HH:MM' with no zone, and guessing the person's zone would fire an hour out
 * twice a year. The screens that set a daily time therefore say what they mean.
 * @param {string} timeOfDay 'HH:MM'
 * @param {Date} from
 * @returns {Date}
 */
function nextDailyAfter(timeOfDay, from) {
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hours, minutes, 0, 0));
  // Strictly after, so a run that finishes at exactly 07:00 is not immediately due
  // again for the same 07:00.
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * When a newly saved automation first runs.
 * @param {{ type: string, intervalMinutes?: number|null, timeOfDay?: string|null, at?: string|null }} cadence A cadence checkedCadence has passed.
 * @param {Date} now
 * @returns {string} ISO instant.
 */
export function firstRunAt(cadence, now) {
  if (cadence.type === 'once') return new Date(cadence.at).toISOString();
  if (cadence.type === 'interval') return new Date(now.getTime() + Number(cadence.intervalMinutes) * 60_000).toISOString();
  return nextDailyAfter(String(cadence.timeOfDay), now).toISOString();
}

/**
 * When an automation runs again after a run that has just finished, or null when it
 * never does.
 *
 * An interval counts from now rather than from the time it was due, so a run that
 * took two minutes does not immediately become due again; the gap the person asked
 * for is a gap between runs. A missed turn is therefore replayed once and then the
 * schedule settles, which is the same rule the desktop scheduler follows.
 * @param {{ type: string, intervalMinutes?: number|null, timeOfDay?: string|null }} cadence
 * @param {Date} now
 * @returns {string|null} ISO instant, or null for a one-off that has fired.
 */
export function nextRunAfter(cadence, now) {
  if (cadence.type === 'once') return null;
  if (cadence.type === 'interval') return new Date(now.getTime() + Number(cadence.intervalMinutes) * 60_000).toISOString();
  return nextDailyAfter(String(cadence.timeOfDay), now).toISOString();
}

/** The one tool an unattended run may use. */
export const SEARCH_TOOL = Object.freeze({
  name: 'webSearch',
  description: 'Search the web and get back titles, links and short snippets. Use it whenever the answer depends on anything current, and search more than once if one query is not enough.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for, in the words you would type into a search engine.' },
    },
    required: ['query'],
  },
});

/**
 * How an unattended run is told to behave.
 *
 * It is separate from the ordinary chat rules because two of them have to be
 * reversed: a scheduled run must never ask a clarifying question, since nobody is
 * there to answer one, and it must say plainly that it found nothing rather than
 * padding the gap, because an empty morning is a real answer.
 */
export const RUN_RULES = [
  'This is a scheduled run. Nobody is reading as you work and nobody can answer you.',
  'Never ask a question. If the request could mean several things, pick the most useful reading, say which one you picked in a short line, and answer it.',
  'Search the web before answering anything that depends on what is true today, such as jobs, prices, news, availability or any listing.',
  'Report only what you actually found, with the source and its link beside each item.',
  'If you found nothing new, say exactly that in one line. Never invent an item, a link or a date to fill the gap.',
  'Write the answer as if it were a short briefing the person will read later on a phone: the useful part first, then the detail.',
].join(' ');

/**
 * The conversation one run sends.
 * @param {string} prompt What the person asked for when they saved the automation.
 * @returns {Array<{ role: string, content: string }>}
 */
export function runMessages(prompt) {
  return [
    { role: 'system', content: ZURI_IDENTITY },
    { role: 'system', content: RESEARCH_RULES },
    { role: 'system', content: ANSWER_RULES },
    { role: 'system', content: RUN_RULES },
    { role: 'user', content: prompt },
  ];
}

/**
 * Turn search results into the text a model reads back.
 *
 * Kept short on purpose: every character is charged as input on the round after it,
 * and a title, a link and a snippet are what a citation needs.
 * @param {{ query: string, results: Array<{ title: string, url: string, snippet: string }> }} found
 * @returns {string}
 */
export function searchResultText(found) {
  const results = Array.isArray(found?.results) ? found.results : [];
  if (results.length === 0) return `No results were found for "${found?.query ?? ''}".`;
  const lines = results.slice(0, 8).map((result, index) => {
    const snippet = words(result.snippet);
    return `${index + 1}. ${words(result.title)}\n${words(result.url)}${snippet === '' ? '' : `\n${snippet.slice(0, 300)}`}`;
  });
  return `Results for "${found.query}":\n${lines.join('\n\n')}`;
}

/**
 * Run one automation to an answer.
 *
 * The loop is the same shape as the browser's: ask, run whatever searches come back,
 * hand the results in, ask again, and stop at the first round that answers in words.
 * The last round offers no tools at all, so a model that would otherwise keep
 * searching has to write the answer it already has.
 *
 * Usage is reserved and committed per round rather than once for the whole run,
 * because a run can take several rounds and a single reservation would either
 * over-reserve the quota or under-bill it.
 *
 * @param {object} options
 * @param {{ id: string, userId: string, prompt: string, cadence: object }} options.automation
 * @param {{ subscriptionId: string, planCode: string }} options.owner
 * @param {object} options.repository
 * @param {Function} options.chatProvider
 * @param {Function} options.searchWeb
 * @param {object[]} options.models The model catalogue.
 * @param {() => Date} [options.now]
 * @returns {Promise<{ status: 'ok'|'failed', text: string, error: string, searches: number }>}
 */
export async function runAutomation({ automation, owner, repository, chatProvider, searchWeb, models, now = () => new Date() }) {
  const model = findModel(models, DEFAULT_MODEL_CODE);
  if (!model) {
    return { status: 'failed', text: '', error: 'No model is switched on for scheduled runs.', searches: 0 };
  }
  const limits = limitsForModel(limitsForPlan(owner.planCode), model);
  const messages = runMessages(automation.prompt);
  const deadline = now().getTime() + RUN_TIMEOUT_MS;

  let searches = 0;

  /** One model round, with its own reservation so the quota is never guessed. */
  const askModel = async (tools) => {
    const reservation = await repository.reserveUsage({
      userId: automation.userId,
      subscriptionId: owner.subscriptionId,
      requestedTokens: quotaTokens(model, limits.maxInputTokens, limits.maxOutputTokens),
      expiresAt: new Date(now().getTime() + RESERVATION_TTL_MS),
    });
    try {
      const result = await chatProvider({
        messages,
        model: model.supplierModel,
        supplier: model.supplier,
        maxTokens: limits.maxOutputTokens,
        signal: AbortSignal.timeout(Math.max(1000, deadline - now().getTime())),
        tools,
      });
      await repository.commitUsage({
        reservationId: reservation.id,
        userId: automation.userId,
        model: result.model,
        modelCode: model.code,
        supplier: model.supplier,
        quotaTokens: quotaTokens(model, result.usage.inputTokens, result.usage.outputTokens),
        costMicroUsd: supplierCostMicroUsd(model, result.usage.inputTokens, result.usage.outputTokens),
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        requestId: `automation-${automation.id}-${reservation.id}`,
      });
      return result;
    } catch (error) {
      // The reservation is let go so a failed round does not eat the person's
      // allowance for work that produced nothing.
      await repository.releaseUsage(reservation.id, automation.userId).catch(() => undefined);
      throw error;
    }
  };

  for (let round = 0; round < MAX_ROUNDS_PER_RUN; round += 1) {
    // The last round, and any round once the search budget is spent, is offered no
    // tools: the model has to answer with what it has rather than search again.
    const lastRound = round === MAX_ROUNDS_PER_RUN - 1 || searches >= MAX_SEARCHES_PER_RUN;
    const result = await askModel(lastRound ? [] : [SEARCH_TOOL]);

    // A search written into the text as markup is not an answer: only what is left
    // before it is, so the saved result can never be a raw tool request.
    const text = plainDashes(words(splitToolCalls(result.content).visible));
    const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];

    if (calls.length === 0) {
      if (text === '') {
        // A round with neither words nor a call is a dead end. Repeating it as it
        // stands would most likely repeat the silence, so the model is asked once
        // more with no tools and told why; only if that is silent too does the run fail.
        messages.push({ role: 'system', content: EMPTY_ROUND_NOTE });
        const retry = await askModel([]);
        const retryText = plainDashes(words(splitToolCalls(retry.content).visible));
        if (retryText === '') {
          return { status: 'failed', text: '', error: 'Zuri did not write an answer for this run.', searches };
        }
        return { status: 'ok', text: retryText, error: '', searches };
      }
      return { status: 'ok', text, error: '', searches };
    }

    // The calls and whatever thinking produced them go back verbatim. A reasoning
    // model refuses to continue a tool round without its own reasoning returned, so
    // dropping it here would break every search.
    messages.push({
      role: 'assistant',
      content: text,
      reasoningContent: words(result.reasoningContent),
      toolCalls: calls,
    });

    for (const call of calls) {
      if (searches >= MAX_SEARCHES_PER_RUN) {
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: 'The search limit for this run has been reached. Answer with what you already have.' });
        continue;
      }
      if (call.name !== SEARCH_TOOL.name) {
        // Only one tool is offered, so a call for anything else is the model
        // inventing a name. It is told plainly rather than silently ignored.
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: `A scheduled run has no ${call.name} tool. Only webSearch is available.` });
        continue;
      }
      let query = '';
      try {
        const parsed = JSON.parse(call.arguments || '{}');
        query = words(parsed?.query);
      } catch {
        query = '';
      }
      if (query === '') {
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: 'That search had no query in it. Send the words to search for.' });
        continue;
      }
      searches += 1;
      try {
        const found = await searchWeb({ query });
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: searchResultText(found) });
      } catch (error) {
        // A search that fails is a fact about the world, not a reason to abandon the
        // run: the model is told and can answer from the rest.
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: `That search failed: ${words(error?.message) || 'the search service could not be reached'}.` });
      }
    }
  }

  return { status: 'failed', text: '', error: 'This run kept searching without reaching an answer.', searches };
}

/**
 * The sweep and the timer around it.
 *
 * Nothing here throws into the caller: this runs unattended on a timer, and one
 * account's broken automation must not stop every other account's. Each failure is
 * recorded against the row it belongs to and the sweep carries on.
 *
 * @param {object} options
 * @param {object} options.repository
 * @param {Function} options.chatProvider
 * @param {Function} options.searchWeb
 * @param {{ sendAutomationResult?: Function, configured?: boolean }} [options.mailer]
 * @param {() => Promise<object[]>} options.loadModels
 * @param {() => Date} [options.now]
 * @param {number} [options.sweepMs]
 * @returns {{ sweepOnce: () => Promise<{ ran: number }>, rearm: () => Promise<number>, start: () => void, stop: () => void }}
 */
export function createAutomationScheduler({
  repository,
  chatProvider,
  searchWeb,
  mailer = null,
  loadModels,
  now = () => new Date(),
  sweepMs = DEFAULT_SWEEP_MS,
}) {
  let timer = null;
  // One sweep at a time. A sweep that outlasts its own interval would otherwise
  // overlap itself, and while the claim makes that safe it is still wasted work.
  let sweeping = false;

  /** Give a next time back to any row a crash left armed for nothing. */
  async function rearm() {
    if (typeof repository?.listStalledAutomations !== 'function') return 0;
    let repaired = 0;
    const stalled = await repository.listStalledAutomations();
    for (const automation of stalled) {
      const next = nextRunAfter(automation.cadence, now());
      // A one-off with no time left has already fired, so it stays retired.
      if (next === null) continue;
      await repository.settleAutomation({ id: automation.id, lastStatus: automation.lastStatus, nextRunAt: next });
      repaired += 1;
    }
    return repaired;
  }

  /** Carry out one automation and record everything about it. */
  async function carryOut(automation, models) {
    const owner = await repository.findAutomationOwner(automation.userId);
    if (!owner) {
      // No active paid subscription: the automation is not run and not destroyed, so
      // it starts again by itself if the person comes back. It is left switched off
      // rather than armed, which is what the null next time does.
      await repository.settleAutomation({ id: automation.id, lastStatus: 'failed', nextRunAt: null });
      return;
    }

    const runId = await repository.startAutomationRun({ automationId: automation.id, userId: automation.userId });
    let outcome = { status: 'failed', text: '', error: 'This run did not finish.', searches: 0 };
    try {
      outcome = await runAutomation({ automation, owner, repository, chatProvider, searchWeb, models, now });
    } catch (error) {
      outcome = { status: 'failed', text: '', error: words(error?.message) || 'This run could not be completed.', searches: 0 };
    }

    await repository.finishAutomationRun({
      id: runId,
      status: outcome.status,
      text: outcome.text,
      error: outcome.error,
      searches: outcome.searches,
    });
    await repository.settleAutomation({
      id: automation.id,
      lastStatus: outcome.status,
      nextRunAt: nextRunAfter(automation.cadence, now()),
    });

    if (typeof repository.appendNotification === 'function') {
      await repository.appendNotification({
        userId: automation.userId,
        kind: outcome.status === 'ok' ? 'automation' : 'error',
        title: outcome.status === 'ok' ? 'Automation finished' : 'Automation needs attention',
        body: outcome.status === 'ok'
          ? (outcome.text || `Scheduled run completed: ${automation.prompt}`)
          : (outcome.error || `Scheduled run failed: ${automation.prompt}`),
      });
    }

    // Email remains an explicit automation option. A provider failure must not turn
    // a completed run into a failed run because the in-app event is already saved.
    if (automation.deliverEmail === true && typeof mailer?.sendAutomationResult === 'function') {
      try {
        await mailer.sendAutomationResult({
          to: owner.email,
          prompt: automation.prompt,
          text: outcome.text,
          failure: outcome.status === 'ok' ? '' : outcome.error,
        });
      } catch (error) {
        console.error('[zuri-cloud] automation email', words(error?.message) || error);
      }
    }
  }

  async function sweepOnce() {
    if (typeof repository?.claimDueAutomations !== 'function') return { ran: 0 };
    const due = await repository.claimDueAutomations({ now: now().toISOString(), limit: SWEEP_BATCH });
    if (due.length === 0) return { ran: 0 };

    // The catalogue is read once per sweep rather than once per automation: it is the
    // same answer for every row and a sweep of ten should not make ten queries.
    const models = await loadModels();
    for (const automation of due) {
      try {
        await carryOut(automation, models);
      } catch (error) {
        console.error(`[zuri-cloud] automation ${automation.id}`, words(error?.message) || error);
        // Even a failure inside the recording has to leave the row armed again, or
        // this automation would never run a second time.
        await repository
          .settleAutomation({ id: automation.id, lastStatus: 'failed', nextRunAt: nextRunAfter(automation.cadence, now()) })
          .catch(() => undefined);
      }
    }
    return { ran: due.length };
  }

  return {
    sweepOnce,
    rearm,
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (sweeping) return;
        sweeping = true;
        sweepOnce()
          .catch((error) => console.error('[zuri-cloud] automation sweep', words(error?.message) || error))
          .finally(() => {
            sweeping = false;
          });
      }, sweepMs);
      // The timer must not be what keeps this process alive, so a shutdown is not
      // held open by a sweep that is merely waiting for its next turn.
      if (typeof timer?.unref === 'function') timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
