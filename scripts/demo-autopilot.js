/**
 * demo-autopilot.js - the Autopilot demo, in two processes, with no window.
 *
 * The story the card asks for: schedule an automation, watch the tick run it,
 * check that the run raised a notification and left a follow-up reminder, then
 * restart Zuri and check that the turn it missed while it was closed is caught up
 * exactly once.
 *
 * What is real here: the automation is saved through store.createAutomation, the
 * run goes through the real startScheduler tick and the real runSchedule (which
 * plans its step, calls runTool, saves its Markdown result, logs a run row, raises
 * a notification and creates the follow-up reminder), and the catch-up is the
 * real catchUpMissedRuns that main.js runs on launch.
 *
 * Three things are stood in for, and each is printed when it happens:
 *
 * - The automation is saved as if it were already a minute old, so its next turn
 *   is five seconds away instead of a minute. Nothing sleeps for a minute.
 * - Its allowed tools list leaves out webSearch on purpose, so the run fails the
 *   way a real mis-scoped agent fails. A run only needs attention, and only leaves
 *   a follow-up reminder, when a step fails, so this is the path the card asks to
 *   see; a successful run would prove nothing about the reminder.
 * - Before the restart, `lastRunAt` is moved back ten minutes, which is exactly
 *   what the store would hold if Zuri had been closed that long. The restart then
 *   runs on the real clock, and the demo can also show that ten missed turns still
 *   produce one run rather than ten.
 *
 * Everything lives in a scratch folder in the system temp directory, so the demo
 * never touches the automations or reminders of whoever runs it.
 * Run via `npm run demo:autopilot`. Exits 0 when every assertion passed, 1 otherwise.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAutomation,
  listAutomations,
  listNotifications,
  listReminders,
  listRuns,
  setStoreRoot,
  updateAutomation,
} from '../src/main/store.js';
import { FOLLOW_UP_DELAY_MINUTES, catchUpMissedRuns, startScheduler, stopScheduler } from '../src/main/scheduler.js';
import { listWorkspaceFiles, setWorkspaceRoot } from '../src/main/tools/index.js';

const PROMPT = 'Check the Zuri demo page for new posts';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
// One folder per run, as demo-act does. A fixed name let two copies of the suite
// open the same store at once, and each one's writes dropped the other's rows.
const SCRATCH_ROOT = path.join(os.tmpdir(), `zuri-demo-autopilot-${process.pid}-${Date.now()}`);
const STORE_DIR = path.join(SCRATCH_ROOT, 'store');
const WORKSPACE_DIR = path.join(SCRATCH_ROOT, 'workspace');

/** Long enough for a five second wait plus a slow run, short enough to fail loudly. */
const TICK_TIMEOUT_MS = 30_000;

/** Ten missed turns, so "one catch-up run" is a claim worth checking. */
const CLOSED_FOR_MINUTES = 10;

/** The second process: after the restart, only the launch sweep runs. */
const RESTART_PHASE = process.argv.includes('--restart');

/** @type {string[]} */
const failures = [];

/**
 * Record one assertion. Details stay on the line so a failure says what it saw.
 * @param {string} label
 * @param {boolean} passed
 * @param {string} [detail]
 */
function check(label, passed, detail = '') {
  const suffix = detail === '' ? '' : ` - ${detail}`;
  if (passed) {
    console.log(`ok   ${label}${suffix}`);
    return;
  }
  failures.push(label);
  console.log(`FAIL ${label}${suffix}`);
}

/**
 * Wait until one automation's lastRunAt is readable on disk, before the second
 * process opens the same store. Re-reading beats sleeping a fixed moment: the store
 * finishes its queued writes in its own time, so a guess either wastes a second or
 * lets the child read the row as it was before the patch.
 * @param {string} automationId
 * @param {string} expected ISO moment the patch wrote.
 * @returns {Promise<void>}
 */
async function waitForStoredLastRun(automationId, expected) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const listed = await listAutomations({ root: STORE_DIR });
    const stored = listed.ok === true ? listed.data.find((entry) => entry.id === automationId) : undefined;
    if (stored?.lastRunAt === expected) return;
    // Past the deadline the restart half reports what it actually found, which says
    // more about the cause than a timeout here would.
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Start the scheduler the way main.js does and hand back the first report that
 * actually ran something. The tick is stopped before the promise settles, so the
 * demo is never racing a second run.
 * @param {{ shown: object[] }} toasts
 * @returns {Promise<object>}
 */
function waitForFirstRun(toasts) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stopScheduler();
      reject(new Error(`no automation ran within ${TICK_TIMEOUT_MS} ms`));
    }, TICK_TIMEOUT_MS);

    startScheduler({
      root: STORE_DIR,
      intervalMs: 500,
      // The Windows toast needs a window; the payload is captured here instead, and
      // the same payload is what the app's notification is built from.
      notify: (message) => {
        toasts.push(message);
        return true;
      },
      onTick: (report) => {
        clearTimeout(timer);
        stopScheduler();
        resolve(report);
      },
    });
  });
}

/**
 * Run the restart half in a fresh process, so "restart" means what it says: no
 * module state, no open handles, only what the store left on disk.
 * @returns {Promise<number>} The child's exit code.
 */
async function runRestartPhase() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, '--restart'], {
      env: { ...process.env, ZURI_DEMO_ROOT: SCRATCH_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') console.log(`  | ${line}`);
      }
    });
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') console.log(`  ! ${line}`);
      }
    });
    child.on('error', (error) => {
      console.log(`  ! could not start the second process: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** The first half: schedule, run, notify, remind, then close the app. */
async function runFirstPhase() {
  await fs.rm(SCRATCH_ROOT, { recursive: true, force: true });
  await fs.mkdir(STORE_DIR, { recursive: true });
  setStoreRoot(STORE_DIR);
  setWorkspaceRoot(WORKSPACE_DIR);

  console.log('1. schedule an automation whose next turn is five seconds away');
  const saved = await createAutomation(
    {
      prompt: PROMPT,
      mode: 'autopilot',
      cadence: { type: 'interval', minutes: 1 },
      // webSearch is missing on purpose: the run has to fail for the follow-up
      // reminder path to be exercised. writeFile stays, so the run still saves its
      // result and the Files listing below is about a real file.
      allowedTools: ['readFile', 'writeFile'],
    },
    // Saved a minute ago, so `nextRunAt` lands a few seconds from now.
    { root: STORE_DIR, now: Date.now() - 55_000 },
  );
  check('the automation is saved', saved.ok === true, saved.ok === true ? saved.data.id : saved.error.code);
  if (saved.ok !== true) return;

  const automationId = saved.data.id;
  const dueInMs = Date.parse(saved.data.nextRunAt) - Date.now();
  check('its next run is seconds away', dueInMs > 0 && dueInMs <= 9_000, `${Math.round(dueInMs / 1000)}s`);

  console.log('2. start the scheduler and wait for the run to finish');
  /** @type {object[]} */
  const toasts = [];
  const report = await waitForFirstRun(toasts);
  check('the tick started exactly one run', report.started === 1, `${report.started} started`);
  check('the run is logged', report.runs.length === 1, `${report.runs.length} row(s) reported`);

  const runs = await listRuns({ root: STORE_DIR });
  const run = runs.ok === true ? runs.data.find((entry) => entry.automationId === automationId) : undefined;
  check('the run log holds the run', run !== undefined, runs.ok === true ? `${runs.data.length} row(s) on disk` : runs.error.code);

  if (run !== undefined) {
    check('the run finished, not left running', run.finishedAt !== null, String(run.finishedAt));
    check(
      'the refused step is why it failed',
      run.status === 'failed' && String(run.error ?? '').includes('not in this agent'),
      `${run.status}: ${run.error ?? 'no error text'}`,
    );
    check('the run is flagged as needing attention', run.needsAttention === true);
    check('the run saved its result in the workspace', typeof run.resultPath === 'string', String(run.resultPath));

    if (typeof run.resultPath === 'string') {
      const listing = await listWorkspaceFiles();
      const listed = listing.files.find((file) => file.path === run.resultPath);
      check('the saved result is in the Files listing', listed !== undefined, String(run.resultPath));
    }
  }

  console.log('3. check the notification');
  check(
    'a notification was raised',
    toasts.length === 1 && toasts[0].title === 'Automation needs attention',
    toasts.length === 0 ? 'none shown' : String(toasts[0].title),
  );
  const notifications = await listNotifications({ root: STORE_DIR });
  const notificationItems = notifications.ok === true ? notifications.data.items : [];
  const loggedNotification = notificationItems.find(
    (entry) => entry.title === 'Automation needs attention',
  );
  check(
    'the notification is recorded for the bell',
    loggedNotification !== undefined,
    notifications.ok === true ? `${notificationItems.length} in notifications.json` : notifications.error.code,
  );

  console.log('4. check the follow-up reminder');
  const reminders = await listReminders({ root: STORE_DIR });
  const followUp =
    reminders.ok === true ? reminders.data.find((entry) => entry.title === `Follow up: ${PROMPT}`) : undefined;
  check(
    'a follow-up reminder was created',
    followUp !== undefined,
    reminders.ok === true ? `${reminders.data.length} reminder(s)` : reminders.error.code,
  );
  if (followUp !== undefined && run !== undefined && run.finishedAt !== null) {
    const expectedDue = Date.parse(run.finishedAt) + FOLLOW_UP_DELAY_MINUTES * 60_000;
    check(
      `the follow-up falls due ${FOLLOW_UP_DELAY_MINUTES} minutes after the run`,
      Math.abs(Date.parse(followUp.dueAt) - expectedDue) < 1_000,
      followUp.dueAt,
    );
    check('the follow-up is still open', followUp.status === 'pending', String(followUp.status));
  }

  console.log(`5. close Zuri, as if it had been shut for ${CLOSED_FOR_MINUTES} minutes`);
  // This is the only stored state the demo writes by hand: it is the same value the
  // last run would have left if the app had been closed that long.
  const closedSince = new Date(Date.now() - CLOSED_FOR_MINUTES * 60_000).toISOString();
  const moved = await updateAutomation(automationId, { lastRunAt: closedSince }, { root: STORE_DIR });
  check('the last run looks ten minutes old', moved.ok === true, moved.ok === true ? closedSince : moved.error.code);

  // Wait for the patch to be readable on disk rather than for a guessed number of
  // milliseconds. A fixed sleep raced the store write queue, and the second process
  // then read the old lastRunAt, found nothing missed and skipped the catch-up the
  // demo exists to prove.
  await waitForStoredLastRun(automationId, closedSince);

  console.log('6. restart in a second process and let the launch catch-up run');
  const childCode = await runRestartPhase();
  check('the restarted app exits cleanly', childCode === 0, `exit ${childCode}`);

  if (failures.length > 0) {
    // Only a failing run keeps its store, and it names it so the files can be read.
    console.log(`data folder: ${STORE_DIR}`);
    console.log(`FAIL demo:autopilot: ${failures.length} assertion(s) failed`);
    process.exit(1);
  }

  // A passing run has no store worth keeping, and this folder is new every time.
  await fs.rm(SCRATCH_ROOT, { recursive: true, force: true });
  console.log('PASS demo:autopilot');
  process.exit(0);
}

/** The second half: a fresh process, the launch sweep, and nothing else. */
async function runRestartPhaseAsChild() {
  const root = process.env.ZURI_DEMO_ROOT;
  if (typeof root !== 'string' || root === '') {
    console.log('FAIL demo:autopilot restart: ZURI_DEMO_ROOT is missing, so there is no data folder to reopen');
    process.exit(1);
  }

  const storeDir = path.join(root, 'store');
  stopScheduler();
  setStoreRoot(storeDir);
  setWorkspaceRoot(path.join(root, 'workspace'));

  const before = await listRuns({ root: storeDir });
  const beforeCount = before.ok === true ? before.data.length : 0;
  check('the run log survived the restart', before.ok === true && beforeCount === 1, `${beforeCount} row(s)`);

  // Same seam the first phase uses: the toast payload is captured instead of shown,
  // because a plain node process has no Electron Notification to show it with.
  /** @type {object[]} */
  const toasts = [];
  const catchUp = await catchUpMissedRuns({
    root: storeDir,
    notify: (message) => {
      toasts.push(message);
      return true;
    },
  });
  check(
    'ten missed turns are found as one missed run',
    catchUp.missed === 1,
    `${catchUp.missed} missed, ${catchUp.caughtUp} caught up`,
  );
  check('exactly one catch-up run started', catchUp.caughtUp === 1, `${catchUp.caughtUp} started`);
  check(
    'the catch-up run belongs to the same automation',
    catchUp.runs.length === 1 && String(catchUp.runs[0].automationId ?? '') !== '',
    catchUp.runs.length === 1 ? catchUp.runs[0].id : 'no run reported',
  );

  const after = await listRuns({ root: storeDir });
  const afterCount = after.ok === true ? after.data.length : 0;
  check('the run log grew by exactly one row', afterCount === beforeCount + 1, `${beforeCount} -> ${afterCount}`);
  check(
    'the caught-up run raised its own notification',
    toasts.length === 1,
    toasts.length === 0 ? 'none' : String(toasts[0].title),
  );

  const again = await catchUpMissedRuns({
    root: storeDir,
    notify: () => true,
  });
  check(
    'a second launch straight afterwards catches up nothing',
    again.missed === 0 && again.caughtUp === 0,
    `${again.missed} missed, ${again.caughtUp} caught up`,
  );

  if (failures.length > 0) {
    console.log(`FAIL demo:autopilot restart: ${failures.length} assertion(s) failed`);
    process.exit(1);
  }

  console.log('PASS demo:autopilot restart');
  process.exit(0);
}

const phase = RESTART_PHASE ? runRestartPhaseAsChild : runFirstPhase;
phase().catch((error) => {
  console.log(`FAIL demo:autopilot: ${error.message}`);
  process.exit(1);
});
