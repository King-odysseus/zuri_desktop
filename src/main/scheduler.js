/**
 * scheduler.js - which scheduled automations are due on this tick.
 *
 * Only the selection lives here, as a pure function over the stored `schedules`
 * array and an explicit clock. The 30-second timer, running an automation and
 * recording the run belong to the scheduler card; keeping the choice free of
 * timers is what lets scripts/selftest.js drive it with a fixed clock instead of
 * waiting on real time.
 *
 * Three rules the earlier stories depend on:
 * - A run missed while Zuri was closed is replayed once, not once per missed
 *   interval, so `dueSchedules` and `missedSchedules` return each automation at
 *   most once however far in the past its `nextRunAt` or `lastRunAt` sits.
 * - A paused automation, and one with no readable `nextRunAt` (still being
 *   created), is skipped quietly rather than treated as due now.
 * - The launch catch-up reads `lastRunAt`, not `nextRunAt`: a schedule that already
 *   ran is only caught up once a whole turn of its cadence has gone by, which is
 *   what stops a second launch straight after the first from running it again.
 */

/** A pause in the UI is stored as `enabled: false`; a missing flag means enabled. */
function isPaused(schedule) {
  return schedule.enabled === false || schedule.paused === true;
}

/**
 * Millisecond time for a stored timestamp, or NaN when it cannot be read.
 * `nextRunAt` is written as an ISO string by the automations module, but a
 * number is accepted so a hand-edited file still fires.
 * @param {unknown} value
 * @returns {number}
 */
function timeOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  return Date.parse(value);
}

/**
 * The automations due at `now`, oldest due first, each listed once.
 *
 * @param {Array<{ id?: string, nextRunAt?: string|number, enabled?: boolean }>} schedules Stored automations.
 * @param {number} [now] Clock in milliseconds; defaults to the wall clock.
 * @returns {Array<object>} The same objects, not copies: the caller advances their nextRunAt.
 */
export function dueSchedules(schedules, now = Date.now()) {
  if (!Array.isArray(schedules)) {
    throw new TypeError('dueSchedules expects the stored schedules array');
  }
  if (!Number.isFinite(now)) {
    throw new TypeError('dueSchedules expects a clock in milliseconds');
  }

  return schedules
    .filter((schedule) => {
      if (!schedule || typeof schedule !== 'object') return false;
      if (isPaused(schedule)) return false;
      const due = timeOf(schedule.nextRunAt);
      return Number.isFinite(due) && due <= now;
    })
    .sort((left, right) => {
      // Equal due times fall back to id so the order is stable across reads of the
      // same file; without it two runs due in the same millisecond could swap.
      const byTime = timeOf(left.nextRunAt) - timeOf(right.nextRunAt);
      if (byTime !== 0) return byTime;
      return String(left.id ?? '').localeCompare(String(right.id ?? ''));
    });
}

/**
 * Whether any automation is due, without building the list.
 * The tick uses this to stay quiet: no due work means no run and no notification.
 * @param {Array<object>} schedules
 * @param {number} [now]
 * @returns {boolean}
 */
export function hasDueSchedule(schedules, now = Date.now()) {
  return dueSchedules(schedules, now).length > 0;
}

/**
 * How long one turn of a cadence takes, in milliseconds.
 *
 * `once` has no turn to be late for - its single moment is covered by `nextRunAt` -
 * so it answers NaN and the launch catch-up leaves it to the tick.
 * @param {{ type?: string, minutes?: number }} cadence
 * @returns {number} Milliseconds, or NaN when the cadence has no repeat.
 */
export function cadenceGapMs(cadence) {
  if (cadence === null || typeof cadence !== 'object') return NaN;
  if (cadence.type === 'interval') {
    const minutes = Number(cadence.minutes);
    return Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) * 60_000 : NaN;
  }
  // A daily automation is late once its time of day has come round again. The
  // catch-up runs it once at launch either way, so a clock change inside the gap
  // costs an hour of precision, never a second run.
  if (cadence.type === 'daily') return 24 * 60 * 60_000;
  return NaN;
}

/**
 * The automations whose last run is a whole cadence behind `now`: the runs that were
 * missed while Zuri was closed.
 *
 * Read against `lastRunAt` rather than `nextRunAt` on purpose. A run writes
 * `lastRunAt` when it ends, so a schedule caught up a moment ago is no longer missed
 * on the next launch, while one that has never run at all is left to the tick - its
 * first run was never missed, it is simply due.
 * @param {Array<{ id?: string, cadence?: object, lastRunAt?: string|number, enabled?: boolean }>} schedules Stored automations.
 * @param {number} [now] Clock in milliseconds; defaults to the wall clock.
 * @returns {Array<object>} The same objects, not copies: running one advances it.
 */
export function missedSchedules(schedules, now = Date.now()) {
  if (!Array.isArray(schedules)) {
    throw new TypeError('missedSchedules expects the stored schedules array');
  }
  if (!Number.isFinite(now)) {
    throw new TypeError('missedSchedules expects a clock in milliseconds');
  }

  return schedules
    .filter((schedule) => {
      if (!schedule || typeof schedule !== 'object') return false;
      if (isPaused(schedule)) return false;
      const last = timeOf(schedule.lastRunAt);
      if (!Number.isFinite(last)) return false;
      const gap = cadenceGapMs(schedule.cadence);
      if (!Number.isFinite(gap) || gap <= 0) return false;
      // A clock that went backwards (a stored timestamp in the future) is not a
      // missed run either; it would otherwise catch the same schedule up forever.
      return now - last >= gap;
    })
    .sort((left, right) => {
      // Oldest missed run first, then by id so two schedules last run in the same
      // millisecond keep a stable order across launches.
      const byTime = timeOf(left.lastRunAt) - timeOf(right.lastRunAt);
      if (byTime !== 0) return byTime;
      return String(left.id ?? '').localeCompare(String(right.id ?? ''));
    });
}

/* ---------------------------------------------------------------- the tick */

import { createRequire } from 'node:module';

import * as store from './store.js';
import { runTool } from './tools/index.js';

/**
 * How often the main process looks for work that has come due. Thirty seconds is
 * finer than any cadence the automations view can save (its smallest gap is a
 * minute), so a schedule fires within half a minute of its moment without the
 * process waking constantly.
 */
export const SCHEDULER_TICK_MS = 30_000;

/**
 * How long after a run that needs attention the follow-up reminder comes due.
 * Half an hour is long enough to finish whatever the person was doing and short
 * enough that the flagged run is still in their mind.
 */
export const FOLLOW_UP_DELAY_MINUTES = 30;

/** Where run results are saved inside the workspace: one folder, newest story on top. */
const RUN_RESULTS_FOLDER = 'automation-runs';

/** How much of one step's output goes into the saved Markdown before it is cut. */
const RUN_RESULT_TEXT_LIMIT = 1500;

/**
 * A file-name-safe piece of an automation's prompt, so the workspace listing says
 * what a result is about rather than showing a UUID.
 * @param {string} text
 * @param {string} [fallback]
 * @returns {string}
 */
function slugFor(text, fallback = 'automation') {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug === '' ? fallback : slug;
}

/**
 * Workspace-relative path for one run's result document. The timestamp keeps two
 * runs of the same automation from overwriting each other.
 * @param {object} schedule
 * @param {number} [moment] Clock in milliseconds; defaults to now.
 * @returns {string} Such as `automation-runs/check-acme-careers-20261023-142000.md`.
 */
export function resultPathFor(schedule, moment = Date.now()) {
  const date = new Date(moment);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${RUN_RESULTS_FOLDER}/${slugFor(schedule?.prompt, 'automation')}-${stamp}.md`;
}

/**
 * The tool calls one automation makes, in order.
 *
 * A schedule may carry its own `steps` (an array of `{ name, args }`) and those
 * are run exactly as written: that is how an automation that was taught a worked
 * example replays it. Otherwise the prompt is the work. A monitoring question
 * ("check the Acme careers page for new roles") is answered by one search, and a
 * prompt that is a plain link is answered by one fetch. Both go through `runTool`,
 * the same entry point Act uses, so every guard applies here too: the agent's
 * allow-list, the workspace boundary, and the URL and app allow-lists.
 * @param {object} schedule A stored automation.
 * @returns {Array<{ name: string, args: Record<string, any> }>}
 */
export function planSteps(schedule) {
  if (schedule === null || typeof schedule !== 'object') {
    throw new TypeError('planSteps expects a stored automation');
  }

  const declared = Array.isArray(schedule.steps)
    ? schedule.steps.filter(
        (step) => step !== null && typeof step === 'object' && typeof step.name === 'string' && step.name !== '',
      )
    : [];
  if (declared.length > 0) {
    return declared.map((step) => ({
      name: step.name,
      args: step.args !== null && typeof step.args === 'object' ? step.args : {},
    }));
  }

  const prompt = typeof schedule.prompt === 'string' ? schedule.prompt.trim() : '';
  if (prompt === '') return [];

  const link = prompt.match(/https?:\/\/[^\s]+/);
  if (link !== null) {
    // Sentence punctuation is not part of the address; fetching "…/jobs." fails.
    const url = link[0].replace(/[.,;:!?)\]]+$/, '');
    return [{ name: 'webFetch', args: { url } }];
  }

  return [{ name: 'webSearch', args: { query: prompt } }];
}

/**
 * One run's result document, saved in the workspace so the answer outlives the
 * toast. Indented code blocks rather than fences: a step's output is arbitrary
 * text, and indentation cannot be broken by a stray fence inside it.
 * @param {{ schedule: object, steps: Array<object>, startedAt: string, finishedAt: string, status: string, needsAttention: boolean, error: string|null }} input
 * @returns {string}
 */
export function formatRunMarkdown(input) {
  const title = String(input.schedule?.prompt ?? '').trim() || 'Automation run';
  const lines = [
    `# ${title}`,
    '',
    `- Automation: ${input.schedule?.id ?? 'unknown'}`,
    `- Mode: ${input.schedule?.mode ?? 'autopilot'}`,
    `- Started: ${input.startedAt}`,
    `- Finished: ${input.finishedAt}`,
    `- Status: ${input.status}`,
    `- Needs attention: ${input.needsAttention ? 'yes' : 'no'}`,
  ];
  if (input.error) lines.push(`- Error: ${input.error}`);

  // The answer comes before the steps because it is what the person opened the file
  // to read: the steps are the working, and a model run has no useful steps to show.
  const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
  if (answer !== '') lines.push('', '## Answer', '', answer);

  lines.push('', '## Steps', '');

  if (input.steps.length === 0) lines.push('No step was planned for this automation.', '');

  input.steps.forEach((step, index) => {
    lines.push(`### ${index + 1}. ${step.name} - ${step.ok ? 'done' : 'failed'}`, '');
    const text = String(JSON.stringify(step.ok ? step.data : step.error, null, 2) ?? '');
    const clipped = text.slice(0, RUN_RESULT_TEXT_LIMIT);
    for (const line of clipped.split(/\r?\n/)) lines.push(`    ${line}`);
    if (text.length > RUN_RESULT_TEXT_LIMIT) lines.push('    ... (truncated)');
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

/**
 * The real Windows notification, made the same way reminders.js makes one: the
 * Electron require is lazy so this module still loads under plain Node, and a
 * platform that cannot show toasts returns false. The run is recorded in
 * notifications.json either way.
 * @param {{ Notification?: any }} [options] Injectable for the project check.
 * @returns {(payload: { title: string, body: string }) => boolean}
 */
export function createRunNotifier(options = {}) {
  const require = createRequire(import.meta.url);
  let Notification = options.Notification ?? null;
  if (Notification === null) {
    try {
      ({ Notification } = require('electron'));
    } catch (error) {
      return () => false;
    }
  }

  if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) {
    return () => false;
  }

  return (payload) => {
    try {
      new Notification({ title: payload.title, body: payload.body }).show();
      return true;
    } catch (error) {
      console.error('[zuri:scheduler] notify', error);
      return false;
    }
  };
}

/**
 * The sentence the bell shows for a finished run. The toast and the history read
 * the same words, so a person who missed the toast sees what it said.
 * @param {object} schedule
 * @param {{ status: string, needsAttention: boolean, stepsDone: number, stepsTotal: number, error: string|null }} run
 * @returns {{ title: string, body: string }}
 */
export function runNotification(schedule, run) {
  const label = String(schedule?.prompt ?? '').trim() || 'An automation';
  const title = run.status === 'failed' ? 'Automation needs attention' : 'Automation finished';
  const body =
    run.status === 'failed'
      ? `${label} - ${run.error ?? 'one of its steps failed'}.`
      : `${label} - ${run.stepsDone} of ${run.stepsTotal} step${run.stepsTotal === 1 ? '' : 's'} done, saved in the workspace.`;
  return { title, body };
}

/**
 * Move an automation on to its next turn. Every run advances it, failed ones
 * included: a broken automation left where it was would be due again on the next
 * tick, thirty seconds later, forever. A one-off has no next turn, so it is paused
 * after it fires and the Automations page shows why.
 * @param {object} schedule
 * @param {string} finishedAt ISO moment the run ended.
 * @param {{ root?: string }} [options]
 * @returns {Promise<object>} The store's result, reported rather than thrown.
 */
async function advanceSchedule(schedule, finishedAt, options = {}) {
  if (typeof schedule?.id !== 'string' || schedule.id === '') {
    return { ok: false, error: { code: 'AUTOMATION_INVALID_ID', message: 'The run has no automation to advance.' } };
  }

  const patch = { lastRunAt: finishedAt };
  if (schedule.cadence?.type === 'once') patch.enabled = false;
  else patch.cadence = schedule.cadence;

  return store.updateAutomation(schedule.id, patch, { root: options.root, now: Date.parse(finishedAt) });
}

/**
 * Run one automation: open a row in runs.json, run each planned step through the
 * tool layer, save the result in the workspace, record and show the notification,
 * leave a follow-up reminder when the result needs attention, then close the row.
 *
 * The steps are confirmed here rather than on screen: scheduling the automation
 * was the decision to let it work, and no one is watching a dialog when the tick
 * fires. Anything that reaches outside Zuri - opening a link or an app - is still
 * gated by the Settings allow-lists inside the tool.
 * @param {object} schedule A stored automation.
 * @param {{
 *   root?: string,
 *   now?: number,
 *   finishAt?: number,
 *   plan?: (schedule: object) => Array<{ name: string, args: object }>,
 *   runStep?: (name: string, args: object, options: object) => Promise<object>,
 *   notify?: (payload: { title: string, body: string }) => boolean,
 *   onProgress?: (change: object) => void,
 *   settings?: object,
 *   dependencies?: Record<string, Function>,
 *   allowedTools?: string[],
 * }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function runSchedule(schedule, options = {}) {
  if (schedule === null || typeof schedule !== 'object') {
    return { ok: false, error: { code: 'SCHEDULE_INVALID', message: 'Running an automation expects a stored automation.' } };
  }

  const startedMs = Number.isFinite(options.now) ? options.now : Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const dryRun = schedule.dryRun === true;

  // A model run replaces the heuristic with the prompt itself. A schedule that was
  // taught explicit steps still replays them exactly as written, and a caller with no
  // model wired in (the offline demo) keeps the single-call plan.
  const declaredSteps = Array.isArray(schedule.steps) && schedule.steps.length > 0;
  // Preview mode must not enter the model tool loop: even a tool that is normally
  // safe in a scheduled run could write before the preview is shown.
  const askModel = !dryRun && declaredSteps === false && typeof options.runPrompt === 'function';
  const planned = askModel
    ? []
    : typeof options.plan === 'function'
      ? options.plan(schedule)
      : planSteps(schedule);
  const runStep =
    typeof options.runStep === 'function'
      ? options.runStep
      : (name, args, stepOptions) => runTool(name, args, stepOptions);
  const notify = typeof options.notify === 'function' ? options.notify : createRunNotifier();
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? Math.min(3, options.maxRetries)
    : 2;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
    ? Math.min(5_000, options.retryDelayMs)
    : 100;

  const opened = await store.startRun(
    {
      automationId: schedule.id,
      title: String(schedule.prompt ?? '').trim(),
      mode: schedule.mode,
      stepsTotal: askModel ? 1 : planned.length,
      startedAt,
    },
    { root: options.root },
  );
  if (opened.ok !== true) return opened;

  const run = opened.data;
  options.onProgress?.({ area: 'automations', status: 'running', run });

  // The allow-list the automation was saved with, unless the caller supplies the
  // agent's own; an empty one means no list beyond the tool's own guard.
  const allowedTools =
    Array.isArray(options.allowedTools) && options.allowedTools.length > 0
      ? options.allowedTools
      : Array.isArray(schedule.allowedTools) && schedule.allowedTools.length > 0
        ? schedule.allowedTools
        : undefined;

  const steps = [];
  let stepsDone = 0;
  let needsAttention = false;
  let failureText = null;
  /** The model's answer, when this run asked one; undefined keeps the file step-only. */
  let answer;

  if (askModel) {
    let outcome;
    try {
      outcome = await options.runPrompt({
        prompt: String(schedule.prompt ?? '').trim(),
        agentId: schedule.agentId ?? null,
        allowedTools,
        signal: options.signal,
        onStatus: (status) => options.onStatus?.(status),
      });
    } catch (error) {
      // runPrompt reports failures as values; a throw here is a bug in what was
      // injected, and it must still leave the run row closed.
      outcome = { ok: false, error: { code: 'MODEL_FAILED', message: String(error?.message ?? error) } };
    }

    const text = outcome?.ok === true ? String(outcome.data?.text ?? '').trim() : '';
    if (text !== '') {
      answer = text;
      stepsDone = 1;
      steps.push({
        name: 'answer',
        ok: true,
        data: { provider: outcome.data?.provider, model: outcome.data?.model, characters: text.length },
      });
    } else {
      needsAttention = true;
      const problem =
        outcome?.ok === true
          ? { code: 'CHAT_EMPTY_REPLY', message: 'The model returned an empty answer.' }
          : outcome?.error ?? { code: 'MODEL_FAILED', message: 'The automation could not run.' };
      failureText = String(problem.message ?? 'The automation could not run.');
      steps.push({ name: 'answer', ok: false, error: problem });
    }
    options.onStatus?.('');
  }

  for (const step of planned) {
    if (dryRun) {
      steps.push({ name: step.name, ok: true, preview: true, data: step.args });
      stepsDone += 1;
      continue;
    }
    let outcome;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        outcome = await runStep(step.name, step.args, {
          confirmed: true,
          allowedTools,
          settings: options.settings,
          dependencies: options.dependencies,
        });
      } catch (error) {
        outcome = { ok: false, error: { code: 'TOOL_FAILED', message: String(error?.message ?? error) } };
      }
      if (outcome?.ok === true || attempt === maxRetries) break;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    const stepOk = outcome?.ok === true;
    steps.push({ name: step.name, ok: stepOk, data: outcome?.data, error: outcome?.error ?? null });
    if (!stepOk) {
      needsAttention = true;
      failureText = failureText ?? String(outcome?.error?.message ?? `${step.name} failed.`);
      continue;
    }

    stepsDone += 1;
    // A tool may see something the person should be told about; that flag is what
    // the follow-up reminder hangs on.
    if (outcome?.data?.needsAttention === true || step.needsAttention === true) needsAttention = true;
  }

  const finishedMs = Number.isFinite(options.finishAt) ? options.finishAt : Date.now();
  const finishedAt = new Date(finishedMs).toISOString();

  const savePath = resultPathFor(schedule, startedMs);
  const markdown = formatRunMarkdown({
    schedule,
    steps,
    answer,
    startedAt,
    finishedAt,
    status: failureText === null ? 'completed' : 'failed',
    needsAttention,
    error: failureText,
  });
  const saved = dryRun
    ? { ok: true, data: { relative: null }, preview: true }
    : await runStep('writeFile', { path: savePath, content: markdown }, { confirmed: true, allowedTools });
  const resultPath = dryRun ? null : saved?.ok === true ? saved.data?.relative ?? savePath : null;
  if (saved?.ok !== true) {
    // Every step may have worked, but an automation whose answer cannot be kept
    // has still failed the person waiting for it.
    needsAttention = true;
    failureText = failureText ?? `The result could not be saved: ${saved?.error?.message ?? 'unknown error'}`;
  }

  const status = failureText === null ? 'completed' : 'failed';
  const closed = await store.finishRun(
    run.id,
    { status, stepsDone, needsAttention, resultPath, error: failureText, finishedAt },
    { root: options.root },
  );
  // A row that could not be closed is still reported from memory, so the toast and
  // the reminder do not depend on the log write succeeding.
  const finishedRun =
    closed.ok === true
      ? closed.data
      : { ...run, status, stepsDone, needsAttention, resultPath, error: failureText, finishedAt };

  const message = runNotification(schedule, finishedRun);
  const logged = await store.appendNotification(message, { root: options.root });
  if (logged.ok !== true) console.error('[zuri:scheduler] notification', logged.error?.message ?? 'not recorded');
  notify(message);

  let reminderId = null;
  if (needsAttention) {
    const followUp = await store.createReminder(
      {
        title: `Follow up: ${String(schedule.prompt ?? '').trim().slice(0, 120) || 'a scheduled run'}`,
        repeat: 'once',
        dueAt: new Date(finishedMs + FOLLOW_UP_DELAY_MINUTES * 60_000).toISOString(),
      },
      { root: options.root },
    );
    if (followUp.ok === true) reminderId = followUp.data.id;
    else console.error('[zuri:scheduler] follow-up', followUp.error?.message ?? 'not saved');
  }

  const advanced = await advanceSchedule(schedule, finishedAt, options);
  if (advanced.ok !== true) {
    console.error('[zuri:scheduler] advance', advanced.error?.message ?? 'next run not moved');
  }

  options.onProgress?.({
    area: 'automations',
    status: finishedRun.status,
    run: finishedRun,
    resultPath,
    needsAttention,
  });

  return {
    ok: true,
    data: {
      run: finishedRun,
      resultPath,
      reminderId,
      notificationId: logged.ok === true ? logged.data.id : null,
      needsAttention,
      nextRunAt: advanced.ok === true ? advanced.data.nextRunAt ?? null : null,
    },
  };
}

/**
 * One pass of the scheduler: read the automations, take the ones that are due, and
 * run them one at a time. Sequential rather than parallel so two automations
 * writing in the workspace cannot interleave.
 * @param {{
 *   root?: string,
 *   now?: number,
 *   plan?: Function,
 *   runStep?: Function,
 *   runPrompt?: Function,
 *   notify?: Function,
 *   onProgress?: Function,
 *   onStatus?: Function,
 *   settings?: object,
 *   dependencies?: Record<string, Function>,
 *   allowedTools?: string[],
 * }} [options]
 * @returns {Promise<{ ok: boolean, due: number, started: number, completed: number, failed: number, needsAttention: number, runs: object[], error?: object }>}
 */
export async function tickScheduler(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const listed = await store.listAutomations(options);
  if (listed.ok !== true) {
    return {
      ok: false,
      due: 0,
      started: 0,
      completed: 0,
      failed: 0,
      needsAttention: 0,
      runs: [],
      error: listed.error,
    };
  }

  const due = dueSchedules(listed.data, now);
  const report = { ok: true, due: due.length, started: 0, completed: 0, failed: 0, needsAttention: 0, runs: [] };

  for (const schedule of due) {
    const outcome = await runSchedule(schedule, options);
    if (outcome.ok !== true) {
      // A run whose row could not even be opened is logged and counted; the next
      // automation still gets its turn.
      console.error('[zuri:scheduler] run', outcome.error?.message ?? 'not started');
      report.failed += 1;
      continue;
    }

    report.started += 1;
    if (outcome.data.run.status === 'failed') report.failed += 1;
    else report.completed += 1;
    if (outcome.data.needsAttention) report.needsAttention += 1;
    report.runs.push(outcome.data.run);
  }

  return report;
}

/**
 * Run, exactly once each, the automations that missed a turn while Zuri was closed.
 *
 * The run goes through `runSchedule`, the same path a live tick uses, so a caught-up
 * run opens a row in the run log, saves its result, raises its notification and moves
 * `lastRunAt` to the moment it ended. That last write is what makes a second launch
 * straight afterwards find nothing to do.
 * @param {Parameters<typeof tickScheduler>[0] & { now?: number }} [options]
 * @returns {Promise<{ ok: boolean, missed: number, caughtUp: number, completed: number, failed: number, needsAttention: number, runs: object[], error?: object }>}
 */
export async function catchUpMissedRuns(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const listed = await store.listAutomations(options);
  if (listed.ok !== true) {
    return {
      ok: false,
      missed: 0,
      caughtUp: 0,
      completed: 0,
      failed: 0,
      needsAttention: 0,
      runs: [],
      error: listed.error,
    };
  }

  const missed = missedSchedules(listed.data, now);
  const report = { ok: true, missed: missed.length, caughtUp: 0, completed: 0, failed: 0, needsAttention: 0, runs: [] };

  for (const schedule of missed) {
    const outcome = await runSchedule(schedule, { ...options, now });
    if (outcome.ok !== true) {
      // The run row could not even be opened, so nothing ran and `lastRunAt` still
      // names the old run: the next tick takes it again rather than losing it.
      console.error('[zuri:scheduler] catch-up', outcome.error?.message ?? 'not started');
      report.failed += 1;
      continue;
    }

    report.caughtUp += 1;
    if (outcome.data.run.status === 'failed') report.failed += 1;
    else report.completed += 1;
    if (outcome.data.needsAttention) report.needsAttention += 1;
    report.runs.push(outcome.data.run);
  }

  return report;
}

/** The live interval, so a second start replaces the first instead of stacking. */
let tickTimer = null;

/**
 * Start the 30-second tick, with the launch catch-up in front of it.
 *
 * The catch-up is the sweep the brief asks for: every automation that missed a run
 * while Zuri was closed is replayed once on launch rather than by a background
 * service. It is awaited before the first tick, so a schedule it has just run has
 * already moved its `nextRunAt` out of the past and is not taken a second time; the
 * timer itself is set up straight away, so the scheduler counts as running from the
 * moment this returns.
 * @param {Parameters<typeof tickScheduler>[0] & { intervalMs?: number, onTick?: (report: object) => void, onCatchUp?: (report: object) => void }} [options]
 * @returns {{ stop: () => void, intervalMs: number }}
 */
export function startScheduler(options = {}) {
  stopScheduler();

  const intervalMs =
    Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? Math.floor(options.intervalMs)
      : SCHEDULER_TICK_MS;

  // A tick still running when the next is due is skipped: a search can outlast its
  // interval, and starting the same automation twice would double its run log and
  // its notification. The launch catch-up holds the same flag, so no tick can read
  // the schedules file while it is half way through replaying them.
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const report = await tickScheduler(options);
      if (report.started > 0 || report.ok !== true) options.onTick?.(report);
    } catch (error) {
      console.error('[zuri:scheduler] tick', error);
    } finally {
      busy = false;
    }
  };

  const launch = async () => {
    busy = true;
    try {
      const report = await catchUpMissedRuns(options);
      if (report.caughtUp > 0 || report.ok !== true) options.onCatchUp?.(report);
    } catch (error) {
      console.error('[zuri:scheduler] catch-up', error);
    } finally {
      busy = false;
    }
    // The first regular pass follows the catch-up, so an automation this launch did
    // not owe a run still starts on time.
    await tick();
  };

  void launch();
  tickTimer = setInterval(() => void tick(), intervalMs);
  // Not holding the process open matters to a script that starts the ticker and
  // then wants to exit.
  tickTimer.unref?.();

  return { stop: stopScheduler, intervalMs };
}

/**
 * Stop the tick. Called on quit, before the window and the store go away.
 * @returns {void}
 */
export function stopScheduler() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/**
 * Whether the tick is live. The runs page asks this to explain a paused scheduler.
 * @returns {boolean}
 */
export function isSchedulerRunning() {
  return tickTimer !== null;
}
