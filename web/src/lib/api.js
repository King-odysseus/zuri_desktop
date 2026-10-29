// Talks to the Zuri Cloud API. The bearer token lives in sessionStorage so it
// disappears when the tab closes; it is never written to localStorage.

/*
 * Tasks and reminders.
 *
 * One list each, owned by the account rather than by a conversation, so a task
 * Zuri adds from one chat is the same row the Tasks page ticks off later. Writes
 * send only the fields that were given: a blank date means "no date" and is left
 * out entirely, which lets the server's own defaults fill a field nobody touched.
 */

/** @param {unknown} value @returns {string} Trimmed text, or '' for anything else. */
function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Every task on the account, open and finished together. The page does the
 * sorting, so the order the server keeps is not relied on here.
 * @returns {Promise<Array<{ id: string, title: string, notes: string, due: string, priority: 'low' | 'normal' | 'high', done: boolean, createdAt?: string, updatedAt?: string }>>}
 */
export async function listTasks() {
  const data = await api('/api/tasks');
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

/**
 * Add one task.
 * @param {{ title: string, notes?: string, due?: string, priority?: 'low' | 'normal' | 'high' }} input
 * @returns {Promise<object>} The stored task, including the id needed to edit it.
 */
export async function createTask(input = {}) {
  const body = { title: trimmedText(input.title) };
  const notes = trimmedText(input.notes);
  if (notes !== '') body.notes = notes;
  const due = trimmedText(input.due);
  if (due !== '') body.due = due;
  const priority = trimmedText(input.priority);
  if (priority !== '') body.priority = priority;
  const data = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
  return data?.task ?? {};
}

/**
 * Change one task. A field left out of the patch is not sent at all, so ticking a
 * task done cannot blank the date or the title a chat gave it.
 * @param {string} id
 * @param {{ title?: string, notes?: string, due?: string, priority?: 'low' | 'normal' | 'high', done?: boolean }} patch
 * @returns {Promise<object>} The task as the server now holds it.
 */
export async function updateTask(id, patch = {}) {
  const body = {};
  if (typeof patch.title === 'string') body.title = patch.title.trim();
  if (typeof patch.notes === 'string') body.notes = patch.notes.trim();
  // An empty string is meaningful here: it clears a date the person removed.
  if (typeof patch.due === 'string') body.due = patch.due.trim();
  if (typeof patch.priority === 'string') body.priority = patch.priority;
  if (typeof patch.done === 'boolean') body.done = patch.done;
  const data = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  return data?.task ?? {};
}

/**
 * Delete one task.
 * @param {string} id
 * @returns {Promise<{ id: string }>}
 */
export async function deleteTask(id) {
  const data = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return data ?? { id };
}

/**
 * Every reminder on the account.
 * @returns {Promise<Array<{ id: string, title: string, dueAt: string, repeat: 'once' | 'interval' | 'daily', intervalMinutes?: number, timeOfDay?: string, done: boolean, createdAt?: string }>>}
 */
export async function listReminders() {
  const data = await api('/api/reminders');
  return Array.isArray(data?.reminders) ? data.reminders : [];
}

/**
 * Add one reminder. dueAt is a full ISO string, which is what the server keeps;
 * the page converts the browser's local date-and-time field before calling here.
 * @param {{ title: string, dueAt: string, repeat?: 'once' | 'interval' | 'daily', intervalMinutes?: number, timeOfDay?: string }} input
 * @returns {Promise<object>} The stored reminder.
 */
export async function createReminder(input = {}) {
  const body = { title: trimmedText(input.title), dueAt: trimmedText(input.dueAt) };
  const repeat = trimmedText(input.repeat);
  if (repeat !== '') body.repeat = repeat;
  // Anything unreadable is left out rather than sent as NaN, which the server
  // would store as a reminder that never fires again.
  const interval = Math.round(Number(input.intervalMinutes));
  if (Number.isFinite(interval) && interval > 0) body.intervalMinutes = interval;
  const timeOfDay = trimmedText(input.timeOfDay);
  if (timeOfDay !== '') body.timeOfDay = timeOfDay;
  const data = await api('/api/reminders', { method: 'POST', body: JSON.stringify(body) });
  return data?.reminder ?? {};
}

/**
 * Tick a reminder off, or put it back on the list. The server owns what "done"
 * means for a repeating reminder, so only that one flag is sent.
 * @param {string} id
 * @param {{ done: boolean }} patch
 * @returns {Promise<object>} The reminder as the server now holds it.
 */
export async function updateReminder(id, patch = {}) {
  const data = await api(`/api/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ done: Boolean(patch.done) }),
  });
  return data?.reminder ?? {};
}

/**
 * Delete one reminder.
 * @param {string} id
 * @returns {Promise<{ id: string }>}
 */
export async function deleteReminder(id) {
  const data = await api(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return data ?? { id };
}

/*
 * Automations: a saved prompt the server runs on a schedule by itself, with the
 * web search it needs, and reports back. The browser only ever lists, creates,
 * pauses and deletes one; the running is the server's own.
 */

/**
 * Every automation on the account, paused ones included. The page does the
 * ordering, so the order the server keeps is not relied on here.
 * @returns {Promise<Array<{ id: string, prompt: string, cadence: { type: 'once' | 'daily' | 'interval', at?: string, timeOfDay?: string, minutes?: number }, enabled: boolean, deliverEmail: boolean, nextRunAt: string | null, lastRunAt: string | null, lastStatus: 'ok' | 'failed' | '', createdAt: string }>>}
 */
export async function listAutomations() {
  const data = await api('/api/automations');
  return Array.isArray(data?.automations) ? data.automations : [];
}

/**
 * Save one automation. The cadence is passed through as the caller built it,
 * because only the caller knows which of its three shapes it is; a cadence that
 * is not an object at all is sent as an empty one so the server's own validation
 * answers rather than the browser inventing a schedule.
 * @param {{ prompt: string, cadence: object, deliverEmail?: boolean }} input
 * @returns {Promise<object>} The stored automation, including the id needed to pause or delete it.
 */
export async function createAutomation(input = {}) {
  const body = {
    prompt: trimmedText(input.prompt),
    cadence: input.cadence !== null && typeof input.cadence === 'object' ? input.cadence : {},
    deliverEmail: Boolean(input.deliverEmail),
  };
  const data = await api('/api/automations', { method: 'POST', body: JSON.stringify(body) });
  return data?.automation ?? {};
}

/**
 * Pause an automation, or start it again. Only that one flag is sent: the next
 * run time is the server's to work out.
 * @param {string} id
 * @param {{ enabled: boolean }} patch
 * @returns {Promise<object>} The automation as the server now holds it.
 */
export async function updateAutomation(id, patch = {}) {
  const data = await api(`/api/automations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: Boolean(patch.enabled) }),
  });
  return data?.automation ?? {};
}

/**
 * Delete one automation.
 * @param {string} id
 * @returns {Promise<{ id: string }>}
 */
export async function deleteAutomation(id) {
  const data = await api(`/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return data ?? { id };
}

/**
 * What one automation has done so far, newest first as the server sends it. This
 * is asked for per automation rather than with the list, because a history is
 * only read once somebody opens that row.
 * @param {string} id
 * @returns {Promise<Array<{ id: string, startedAt: string, finishedAt: string | null, status: 'ok' | 'failed', text: string, error: string }>>}
 */
export async function listAutomationRuns(id) {
  const data = await api(`/api/automations/${encodeURIComponent(id)}/runs`);
  return Array.isArray(data?.runs) ? data.runs : [];
}

const TOKEN_KEY = 'zuri-cloud-token';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** @returns {string} */
export function readToken() {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

/** @param {string} token */
export function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Call the API and unwrap the { ok, data } envelope.
 * The thrown error keeps the HTTP status so callers can tell "not signed in" (401)
 * apart from "this server has not configured billing" (503).
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function api(path, options = {}) {
  const token = readToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.error?.message ?? 'The request failed.');
    error.status = response.status;
    // The server names its refusals (EMAIL_TAKEN, INVALID_CREDENTIALS and so on)
    // and the screens turn those names into sentences a person can act on. A
    // server that sends no code leaves this empty and the message is used.
    error.code = body?.error?.code ?? '';
    throw error;
  }
  return body.data;
}

/*
 * Which plans may use which picture model, cheapest first. format.js keeps the
 * same ladder for the plan tiles but does not export it, and this module carries
 * no imports of its own, so the four codes are named once here. The list only
 * decides what a menu greys out; it never decides whether a picture is drawn.
 */
const PICTURE_PLANS = ['starter', 'pro', 'power', 'max'];

/** @param {unknown} code @returns {number} Position on the ladder, or -1 when it is not on it. */
function picturePlanRank(code) {
  return PICTURE_PLANS.indexOf(String(code ?? '').toLowerCase());
}

/** @param {string} value */
function capitalised(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * "zuri-sketch" into "Zuri Sketch", so a catalogue entry that arrives without a
 * name still reads as a model rather than as a bare code.
 * @param {string} code
 */
function nameFromCode(code) {
  return String(code)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalised)
    .join(' ');
}

/**
 * Whole Naira for one picture on the caller's plan. A plan the catalogue does not
 * price falls back to its highest price, which is the "from" figure a menu can show
 * honestly, and nothing readable at all becomes 0 rather than an invented number.
 * @param {{ plans?: Array<{ code?: string, priceKobo?: number }> }} model
 * @param {string} planCode Lower case, or '' when the plan is unknown.
 * @returns {number}
 */
function nairaForPicture(model, planCode) {
  const plans = Array.isArray(model?.plans) ? model.plans : [];
  // Kobo to Naira, rounded: 5998 reads as NGN 60 rather than NGN 59.98.
  const nairaOf = (entry) => {
    const naira = Math.round(Number(entry?.priceKobo) / 100);
    return Number.isFinite(naira) && naira > 0 ? naira : 0;
  };

  const own = plans.find((entry) => String(entry?.code ?? '').toLowerCase() === planCode);
  const ownNaira = own ? nairaOf(own) : 0;
  if (ownNaira > 0) return ownNaira;

  // No entry for this plan, or one whose price is unreadable: the dearest picture
  // is the one a menu can honestly promise as a starting price.
  const amounts = plans.map(nairaOf).filter((naira) => naira > 0);
  return amounts.length > 0 ? Math.max(...amounts) : 0;
}

/**
 * The one line the composer's menu shows beside a model: its price, or the plan
 * that unlocks a model this account cannot use yet, because "locked" on its own
 * tells nobody what to do about it.
 * @param {{ name: string, nairaPerImage: number, available: boolean, minPlan: string }} entry
 */
function hintForPicture({ name, nairaPerImage, available, minPlan }) {
  if (!available && minPlan !== '') return `${name}, needs the ${capitalised(minPlan)} plan`;
  if (nairaPerImage > 0) return `${name}, about NGN ${nairaPerImage} an image`;
  return `${name}, price not listed`;
}

/**
 * The picture models the composer may offer, read from the public image catalogue.
 *
 * Not from /api/models: that route answers a signed-in account on a paid plan and
 * refuses everyone else, so a menu built from it stayed empty for most people and
 * there was no way to ask for a picture at all. /api/image-prices is public and
 * carries the same catalogue, so the menu fills in for whoever the composer is
 * shown to.
 *
 * `available` only decides what reads as locked in the menu; it never decides
 * whether a picture can be drawn. The server checks the account's plan again when
 * the picture is asked for, which is why an unknown plan on either side, ours or
 * the model's, is left open instead of greying out a menu that may well be right.
 *
 * Like the other catalogue readers this never throws. A menu with no picture
 * models is a far smaller problem than a chat screen that will not load, so a 404,
 * an outage or a malformed answer all leave an empty list.
 * @param {string} [planCode] This account's plan, such as 'pro'. Omit it when unknown.
 * @returns {Promise<Array<{ code: string, name: string, kind: 'image', minPlan: string, hint: string, nairaPerImage: number, available: boolean }>>}
 */
export async function fetchPictureModels(planCode = '') {
  try {
    const data = await api('/api/image-prices');
    const catalogue = Array.isArray(data) ? data : [];
    const plan = String(planCode ?? '').trim().toLowerCase();
    const accountRank = picturePlanRank(plan);

    const models = [];
    for (const entry of catalogue) {
      if (!entry || typeof entry !== 'object') continue;
      const code = typeof entry.code === 'string' ? entry.code.trim() : '';
      // A model with no code is one the composer could never ask for.
      if (code === '') continue;

      const minPlan = typeof entry.minPlan === 'string' ? entry.minPlan.trim() : '';
      const floor = picturePlanRank(minPlan);
      const available = plan === '' || accountRank === -1 || floor === -1 || floor <= accountRank;
      const nairaPerImage = nairaForPicture(entry, plan);
      const statedName = typeof entry.name === 'string' ? entry.name.trim() : '';
      const name = statedName !== '' ? statedName : nameFromCode(code);

      models.push({
        code,
        name,
        kind: 'image',
        minPlan,
        hint: hintForPicture({ name, nairaPerImage, available, minPlan }),
        nairaPerImage,
        available,
      });
    }

    // Cheapest entry point first: the lowest plan that can use a model, then its
    // price. A model whose floor is off the ladder cannot be placed, so it goes
    // last rather than ahead of Starter.
    const floorOf = (model) => {
      const rank = picturePlanRank(model.minPlan);
      return rank === -1 ? PICTURE_PLANS.length : rank;
    };
    return models.sort((a, b) => floorOf(a) - floorOf(b) || a.nairaPerImage - b.nairaPerImage);
  } catch {
    // Deliberately silent: the composer renders no picture models when this is
    // empty, and an error about pictures would bury the chat it sits in.
    return [];
  }
}

/** @returns {Promise<Array<{ code: string, name: string, currency: string, amountKobo: number, monthlyTokens: number }>>} */
export async function fetchPlans() {
  const data = await api('/api/plans');
  return Array.isArray(data) ? data : [];
}

/**
 * The image catalogue: one entry per image model, with its price and the number
 * of images a month on each plan. Prices are read from the server rather than
 * written into the page, so a rate change needs no redeploy of the site.
 *
 * Unlike plans, this never throws: the image cards are an extra on a marketing
 * page, so a server that has not shipped the endpoint yet (a 404) leaves the
 * page exactly as it was instead of replacing it with an error.
 * @returns {Promise<Array<{ code: string, name: string, kind: string, minPlan: string, quotaTokensPerImage: number, plans: Array<{ code: string, priceKobo: number, images: number }> }>>}
 */
export async function fetchImagePrices() {
  try {
    const data = await api('/api/image-prices');
    return Array.isArray(data) ? data : [];
  } catch {
    // Deliberately silent: the caller renders no image section when this is
    // empty, and an error about pictures would bury the plans it sells.
    return [];
  }
}

/**
 * The extra-usage packs sold on top of a plan, priced in kobo on the server so a
 * rate change needs no redeploy of the site.
 *
 * Like the image catalogue this never throws: a server that has not shipped the
 * endpoint yet (a 404) leaves the top-up section off the page instead of
 * replacing the usage numbers with an error about a shop that is closed.
 * @returns {Promise<Array<{ code: string, name: string, tokens: number, amountKobo: number, validDays: number }>>}
 */
export async function fetchTopups() {
  try {
    const data = await api('/api/topups');
    return Array.isArray(data) ? data : [];
  } catch {
    // Deliberately silent: an empty list renders no top-up section at all.
    return [];
  }
}

/**
 * Load everything the dashboard shows in one round trip.
 * Billing is optional: a server without Paystack answers 503 there, and the
 * dashboard should still render plans and usage.
 */
export async function fetchAccount() {
  const [me, usage, limits, billing] = await Promise.all([
    api('/api/me'),
    api('/api/me/usage'),
    api('/api/me/limits'),
    api('/api/me/billing').catch((error) => {
      if (error.status === 503) return { subscription: null, payments: [] };
      throw error;
    }),
  ]);
  return { me, usage, limits, billing };
}

/** @param {string} displayName */
export function updateAccountName(displayName) {
  return api('/api/me', {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  });
}

/** @returns {Promise<string>} */
export function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve('ready');
    script.onerror = () => reject(new Error('Google sign-in could not be loaded. Check your connection and reload the page.'));
    document.head.append(script);
  });
}

/**
 * Start a Paystack checkout and hand back the URL to visit.
 * @param {string} planCode
 * @returns {Promise<string>}
 */
export async function createCheckout(planCode) {
  const data = await api('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planCode }),
  });
  if (!data?.authorizationUrl) throw new Error('Paystack did not return a checkout link.');
  return data.authorizationUrl;
}

/**
 * Start a Paystack checkout for one extra-usage pack and hand back the URL to
 * visit. The route answers 503 while the server has no Paystack key, and the
 * thrown error keeps that status so the notice can say what is missing.
 * @param {string} packCode
 * @returns {Promise<string>}
 */
export async function createTopupCheckout(packCode) {
  const data = await api('/api/billing/topup', {
    method: 'POST',
    body: JSON.stringify({ packCode }),
  });
  if (!data?.authorizationUrl) throw new Error('Paystack did not return a checkout link.');
  return data.authorizationUrl;
}

/** @param {string} reference */
export async function verifyPayment(reference) {
  return api(`/api/billing/verify?reference=${encodeURIComponent(reference)}`);
}

/**
 * Spend, revenue and model settings for the admin dashboard. The server answers
 * 403 for anyone who is not an administrator.
 * @param {number} [days] Look-back window.
 */
export async function fetchAdminOverview(days = 30) {
  return api(`/api/admin/overview?days=${encodeURIComponent(days)}`);
}

/** @param {object} model One catalogue entry, in the shape the overview returns. */
export async function saveAdminModel(model) {
  return api('/api/admin/models', { method: 'PUT', body: JSON.stringify(model) });
}

export async function fetchAdminStats(days = 30) {
  return api(`/api/admin/stats?days=${encodeURIComponent(days)}`);
}

export async function fetchAdminUsers(search = '') {
  return api(`/api/admin/users?search=${encodeURIComponent(search)}`);
}

/** @param {{ email: string, displayName?: string, planCode: string, days: number }} person */
export async function createAdminUser(person) {
  return api('/api/admin/users', { method: 'POST', body: JSON.stringify(person) });
}

/** @param {string} userId @param {{ action: string, planCode?: string, days?: number }} change */
export async function changeAdminUser(userId, change) {
  return api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(change) });
}

export async function signOutRequest() {
  // Signing out is best effort: the token is cleared by the caller either way.
  await api('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined);
}

/*
 * Projects: a folder a customer puts chats in, with one set of standing
 * instructions and a few reference files. Everything below is stated once here so
 * the project screen and the chat screen file a chat the same way.
 */

/**
 * This account's projects. The list carries the counts rather than the contents,
 * because a project screen draws its cards before it reads anything inside one.
 * @returns {Promise<Array<{ id: string, name: string, instructions: string, fileCount: number, conversationCount: number, createdAt?: string, updatedAt?: string }>>}
 */
export async function fetchProjects() {
  const data = await api('/api/me/projects');
  return Array.isArray(data?.projects) ? data.projects : [];
}

/**
 * One project with everything its screen draws: the project, its files and the
 * chats filed under it. Each field is defaulted here rather than in the screen, so
 * a partial answer leaves an empty section instead of crashing the render.
 * @param {string} id
 * @returns {Promise<{ project: object, files: Array<object>, conversations: Array<object> }>}
 */
export async function fetchProject(id) {
  const data = await api(`/api/me/projects/${encodeURIComponent(id)}`);
  return {
    project: data?.project ?? {},
    files: Array.isArray(data?.files) ? data.files : [],
    conversations: Array.isArray(data?.conversations) ? data.conversations : [],
  };
}

/**
 * Start a project. The instructions are optional, because a project can be opened
 * as a plain folder and explained afterwards.
 * @param {string} name
 * @param {string} [instructions]
 * @returns {Promise<object>}
 */
export async function createProject(name, instructions = '') {
  const text = typeof instructions === 'string' ? instructions.trim() : '';
  const data = await api('/api/me/projects', {
    method: 'POST',
    // An empty instruction block is left out, so a project opened as a plain
    // folder is stored as one.
    body: JSON.stringify({ name, ...(text === '' ? {} : { instructions: text }) }),
  });
  return data?.project ?? {};
}

/**
 * Change a project's name or its instructions. Only the fields that were passed
 * are sent, so renaming a project never overwrites instructions written elsewhere.
 * @param {string} id
 * @param {{ name?: string, instructions?: string }} changes
 * @returns {Promise<object>}
 */
export async function updateProject(id, changes = {}) {
  const body = {};
  if (typeof changes.name === 'string') body.name = changes.name;
  if (typeof changes.instructions === 'string') body.instructions = changes.instructions;
  const data = await api(`/api/me/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return data?.project ?? {};
}

/** @param {string} id */
export async function deleteProject(id) {
  return api(`/api/me/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Attach one reference file to a project.
 *
 * A project file arrives in one of two shapes, and the screen sends only the one it
 * has: a link plus its size for a picture or a PDF that was uploaded to Cloudinary,
 * or the text itself for a small text file, which keeps a note searchable and needs
 * no CDN. A field with no value is left out rather than sent empty.
 * @param {string} projectId
 * @param {{ name: string, kind?: string, bytes?: number, url?: string, content?: string }} file
 * @returns {Promise<object>}
 */
export async function addProjectFile(projectId, file) {
  const body = { name: file?.name ?? '' };
  if (typeof file?.kind === 'string' && file.kind !== '') body.kind = file.kind;
  if (Number.isFinite(file?.bytes) && file.bytes > 0) body.bytes = Math.round(file.bytes);
  if (typeof file?.url === 'string' && file.url !== '') body.url = file.url;
  if (typeof file?.content === 'string' && file.content !== '') body.content = file.content;
  const data = await api(`/api/me/projects/${encodeURIComponent(projectId)}/files`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data?.file ?? {};
}

/** @param {string} projectId @param {string} fileId */
export async function deleteProjectFile(projectId, fileId) {
  return api(
    `/api/me/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
  );
}

/**
 * File a chat into a project, or take it out again with null.
 *
 * The chat is patched rather than the project, so the chat screen and the project
 * screen move a thread the same way and the project's own counts follow on their
 * own. An empty string is treated as null, because a screen that holds no project
 * in a form field should not have to translate that first.
 * @param {string} id
 * @param {string | null} projectId
 * @returns {Promise<object>}
 */
export async function setConversationProject(id, projectId) {
  const data = await api(`/api/me/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ projectId: projectId == null || projectId === '' ? null : projectId }),
  });
  return data?.conversation ?? {};
}

// Saved conversations and the live chat stream ---------------------------------

/** The model a new chat starts on. The composer's dropdown changes it per message. */
export const DEFAULT_CHAT_MODEL = 'zuri-flash';

/**
 * This account's saved conversations, newest first as the server sends them.
 * A query asks the server to match titles and message text without downloading
 * every thread into the browser, and a project id narrows the same list to one
 * project's chats, so both filters travel together in one request.
 * @param {string} [query] A call with no search text, fetchConversations(query = ''), lists every chat.
 * @param {string} [projectId] Send one project's id to list only its chats.
 * @returns {Promise<Array<{ id: string, title: string, createdAt?: string, updatedAt?: string, projectId?: string | null }>>}
 */
export async function fetchConversations(query = '', projectId = '') {
  const trimmed = typeof query === 'string' ? query.trim().slice(0, 120) : '';
  const project = typeof projectId === 'string' ? projectId.trim() : '';
  // Both filters ride in one request: a project screen asks for that project's
  // chats, and the search box narrows them without a second round trip.
  // Each value is encoded on its own, so a title with an ampersand cannot split it.
  const filters = [];
  if (trimmed !== '') filters.push(`q=${encodeURIComponent(trimmed)}`);
  if (project !== '') filters.push(`projectId=${encodeURIComponent(project)}`);
  const built = filters.join('&');
  const suffix = built === '' ? '' : `?${built}`;
  const data = await api(`/api/me/conversations${suffix}`);
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

/**
 * One conversation with its messages. A chat that was never written to still has
 * to render, so a missing messages field becomes an empty list rather than a
 * crash while drawing the thread.
 * @param {string} id
 * @returns {Promise<{ id: string, title: string, messages: Array<{ role: string, content: string, createdAt?: string }> }>}
 */
export async function fetchConversation(id) {
  const data = await api(`/api/me/conversations/${encodeURIComponent(id)}`);
  const conversation = data?.conversation ?? {};
  return { ...conversation, messages: Array.isArray(data?.messages) ? data.messages : [] };
}

/**
 * Start a saved conversation. The chat screen calls this on the first send, so a
 * person who opens a new chat and then changes their mind leaves no empty rows.
 * The model travels with the thread so a chat opened elsewhere is answered by the
 * same model it was started with.
 * @param {string} title
 * @param {string} [model]
 * @param {string} [projectId] Set when the chat is started from inside a project.
 */
export async function createConversation(title, model, projectId = '') {
  const project = typeof projectId === 'string' ? projectId.trim() : '';
  const data = await api('/api/me/conversations', {
    method: 'POST',
    // A chat started outside a project sends no projectId at all, so the server
    // never has to tell "filed nowhere" apart from "not asked for".
    body: JSON.stringify({ title, model, ...(project === '' ? {} : { projectId: project }) }),
  });
  return data?.conversation ?? {};
}

/**
 * Store finished turns in a conversation, one request per turn. The server takes a
 * single message at a time, and sending the question first means a reply that fails
 * to save never leaves the chat with an answer and no question.
 * @param {string} id
 * @param {Array<{ role: string, content: string }>} messages
 */
export async function appendMessage(id, messages) {
  let last = null;
  for (const message of messages) {
    last = await api(`/api/me/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: message.role,
        content: message.content,
        // Only a turn that carries a file sends one, so an ordinary question stays
        // the same small request it always was.
        ...(message.attachment ? { attachment: message.attachment } : {}),
      }),
    });
  }
  return last;
}

/** @param {string} id @param {string} title */
export async function renameConversation(id, title) {
  const data = await api(`/api/me/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  return data?.conversation ?? {};
}

/** @param {string} id */
export async function deleteConversation(id) {
  return api(`/api/me/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Where the streamed chat request goes. The server has one chat route, shared by the
 * desktop app and this screen, so there is nothing to fall back to.
 */
const CHAT_PATH = '/api/chat';

/** @param {Response} response @returns {Promise<Error>} */
async function streamFailure(response) {
  const body = await response.json().catch(() => null);
  const error = new Error(body?.error?.message ?? 'The chat request failed.');
  error.status = response.status;
  error.code = body?.error?.code ?? '';
  return error;
}

/**
 * Send the conversation and read the reply as it arrives.
 *
 * The answer is server-sent events: each event is one `data: ` line holding JSON,
 * closed by a blank line. `delta` carries the text that just arrived, `done`
 * carries the finished reply, and `error` carries the server's own refusal. One
 * reader over the response body is the whole parser, which is why no streaming
 * library is needed.
 *
 * @param {{
 *   messages: Array<object>,
 *   model?: string,
 *   projectId?: string,
 *   signal?: AbortSignal,
 *   onDelta?: (text: string) => void,
 *   tools?: Array<{ name: string, description: string, parameters: object }>,
 * }} input
 * @returns {Promise<{ content: string, toolCalls: Array<{ id: string, name: string, arguments: string }>, model?: string, modelName?: string, usage?: object }>}
 */
export async function streamChat({ messages, model = DEFAULT_CHAT_MODEL, projectId = '', signal, onDelta, tools = [] }) {
  // A round that offers tools is answered in one JSON body rather than a stream,
  // because that answer is words plus the calls the model wants run, and the two
  // cannot be told apart while they are being written. No tools at all leaves the
  // field out, so a round that is not a tool round is the request it always was.
  const offered = Array.isArray(tools) ? tools : [];
  // A project rides with the question so the server can put that project's own
  // instructions and reference files in front of it. Outside a project the field
  // is left out rather than sent empty.
  const project = typeof projectId === 'string' ? projectId.trim() : '';
  const token = readToken();
  const response = await fetch(`${API_BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages,
      model,
      stream: true,
      ...(project === '' ? {} : { projectId: project }),
      ...(offered.length === 0 ? {} : { tools: offered }),
    }),
    signal,
  });

  if (!response.ok) throw await streamFailure(response);
  // The two answers share this route, so they are told apart by what the server
  // said it sent rather than by asking for one shape and hoping. A tool round
  // comes back as one JSON body: the words and the calls arrive together.
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const body = await response.json().catch(() => null);
    if (!body?.ok) {
      const error = new Error(body?.error?.message ?? 'The chat request failed.');
      error.status = response.status;
      error.code = body?.error?.code ?? '';
      throw error;
    }
    const data = body?.data ?? {};
    return {
      content: typeof data.content === 'string' ? data.content : '',
      toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
      // A reasoning supplier will not accept the tool round unless the thinking that
      // produced the calls travels with them, so it is carried to the caller and
      // echoed on the next request. Nobody sees it.
      reasoningContent: typeof data.reasoningContent === 'string' ? data.reasoningContent : '',
      ...(data.model === undefined ? {} : { model: data.model }),
      ...(data.modelName === undefined ? {} : { modelName: data.modelName }),
    };
  }
  // A browser without ReadableStream support would hang on a reply it can never
  // read, so say so instead of leaving a bubble waiting for ever.
  if (!response.body) throw new Error('This browser cannot read a streamed reply. Update it or use a current Chrome, Edge, Safari or Firefox.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are one line each. A chunk can stop halfway through a line, so a
      // line is only read once its newline has arrived and the tail stays buffered.
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;

        const payload = line.slice('data:'.length).trim();
        if (!payload) continue;

        let event = null;
        try {
          event = JSON.parse(payload);
        } catch {
          // A comment or keep-alive line: nothing to show and nothing to fail.
          continue;
        }

        if (event.type === 'delta' && typeof event.text === 'string') {
          content += event.text;
          onDelta?.(event.text);
          continue;
        }

        // The done frame carries any tool calls, so a streamed tool round still
        // says what to run. The text stays the streamed text when the frame omits it.
        if (event.type === 'done') {
          return {
            ...(event.data ?? {}),
            content: event.data?.content || content,
            toolCalls: Array.isArray(event.data?.toolCalls) ? event.data.toolCalls : [],
            reasoningContent: typeof event.data?.reasoningContent === 'string' ? event.data.reasoningContent : '',
          };
        }

        if (event.type === 'error') {
          const error = new Error(event.error?.message ?? 'The chat request failed.');
          error.code = event.error?.code ?? '';
          // Marked so the screen can tell a refusal mid-reply from a failed POST.
          error.streamed = true;
          throw error;
        }
      }
    }
  } finally {
    // Stop leaves the reader holding a connection that nothing will drain.
    reader.cancel().catch(() => undefined);
  }

  // The stream ended without `done`, which means the network dropped mid-reply.
  // What did arrive is still worth keeping on screen, so it is returned.
  // Kept in the same shape as every other answer, so a caller reads one thing
  // either way.
  return { content, toolCalls: [] };
}

/**
 * Run a web search for the model.
 *
 * The search key lives on the server, so the browser asks for results and never
 * for the key, and the model only ever reads the list this hands back. A failure
 * throws, which is the caller's cue to tell the model the search did not run
 * rather than to end the person's reply.
 * @param {string} query
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
 */
export async function searchWeb(query) {
  const data = await api('/api/tools/web-search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
  return Array.isArray(data?.results) ? data.results : [];
}

// Every password route in one place: signing up, signing in, and the three
// things a password can do after that. The server names them as one family, so
// a change of prefix is a change in this one object.
const AUTH_ROUTES = {

  signUp: '/api/auth/sign-up',
  signIn: '/api/auth/sign-in',
  forgotPassword: '/api/auth/forgot-password',
  resetPassword: '/api/auth/reset-password',
  setPassword: '/api/auth/set-password',
};

/**
 * Create an account with an email and a password. The reply carries the session
 * token, exactly as the Google route does.
 * @param {{ email: string, password: string, displayName: string }} input
 */
export async function signUpWithPassword({ email, password, displayName }) {
  return api(AUTH_ROUTES.signUp, {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

/** @param {{ email: string, password: string }} input */
export async function signInWithPassword({ email, password }) {
  return api(AUTH_ROUTES.signIn, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Ask for a reset link. The answer is deliberately the same whether or not the
 * address has an account, so this tells the person to watch their inbox and
 * nothing about who is registered.
 * @param {string} email
 */
export async function requestPasswordReset(email) {
  return api(AUTH_ROUTES.forgotPassword, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** @param {{ token: string, password: string }} input */
export async function resetPassword({ token, password }) {
  return api(AUTH_ROUTES.resetPassword, {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

/**
 * Add an email and password to the signed-in account, for people who arrived
 * through Google and want a second way in.
 * @param {string} password
 */
export async function setPassword(password) {
  return api(AUTH_ROUTES.setPassword, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

/**
 * Read a file as base64, without the "data:<kind>;base64," prefix.
 *
 * FileReader is used rather than File.arrayBuffer() because turning bytes into
 * base64 by hand in a browser means writing the encoder; readAsDataURL already
 * does that work, so only its prefix is stripped here.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read. Try choosing it again.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) {
        reject(new Error('That file could not be read. Try choosing it again.'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The address an image tag can load for a stored file.
 *
 * An <img> cannot send the Authorization header, so the session token travels in
 * the query string instead, which is the one other way GET /api/files/<id> takes
 * it. An image tag and a new tab both load an address with no header, so both
 * need the token there; the path itself is left exactly as it was stored.
 *
 * The path is made absolute the same way api() builds its request URLs, since
 * the site and the API may sit on different origins.
 * @param {string} url A file's own path, such as /api/files/abc.
 * @param {string} [token] Defaults to the token this tab holds.
 * @returns {string} An address for an image tag, or '' when there is no path.
 */
export function fileDisplayUrl(url, token = readToken()) {
  const path = typeof url === 'string' ? url.trim() : '';
  if (path === '') return '';
  // Only a path this API serves needs a token. A file already addressed by a
  // whole URL (a picture an older build filed on a CDN) is left exactly as it is:
  // nothing there reads a token, and one could break a signed address.
  if (!path.startsWith('/')) return path;
  const absolute = `${API_BASE_URL}${path}`;
  if (token === '') return absolute;
  const separator = absolute.includes('?') ? '&' : '?';
  return `${absolute}${separator}t=${encodeURIComponent(token)}`;
}

/**
 * Upload one file to this account's own file store.
 *
 * The bytes travel inside a JSON body as base64, so the request is same-origin
 * and carries the bearer token like every other call in this module. The reply
 * names the file's path, which GET /api/files/<id> serves; displayUrl is that
 * path with this tab's token already on it, ready for an image tag.
 *
 * A refusal is thrown by api() with the server's own wording, so a picture over
 * the 4 MB limit reads as the server's own sentence rather than a generic one.
 * @param {File} file
 * @returns {Promise<{ url: string, name: string, kind: string, bytes: number, displayUrl: string }>}
 */
export async function uploadFile(file) {
  const kind = typeof file.type === 'string' && file.type !== '' ? file.type : 'application/octet-stream';
  const data = await api('/api/files', {
    method: 'POST',
    body: JSON.stringify({ name: file.name, kind, dataBase64: await readAsBase64(file) }),
  });
  const stored = data?.file ?? {};
  const url = typeof stored.url === 'string' ? stored.url.trim() : '';
  if (url === '') throw new Error('The upload finished without a link to the file.');
  return {
    url,
    name: typeof stored.name === 'string' && stored.name !== '' ? stored.name : file.name,
    kind: typeof stored.kind === 'string' && stored.kind !== '' ? stored.kind : kind,
    bytes: Number.isFinite(Number(stored.bytes)) ? Number(stored.bytes) : file.size,
    displayUrl: fileDisplayUrl(url),
  };
}

/*
 * The two Cloudinary helpers below are still used by the projects screen, so the
 * chat stops calling them but they stay. Nothing new should reach for them:
 * uploadFile above is same-origin and needs no third-party account.
 */

/**
 * Ask the account to sign one upload.
 *
 * The bytes never pass through the API: this returns a signature, the folder it
 * was signed for and the limits to check before trying, and the file then goes
 * straight from this tab to Cloudinary's CDN.
 * @returns {Promise<{ cloudName: string, apiKey: string, folder: string, timestamp: number, signature: string, maxBytes: number, allowedTypes: string[] }>}
 */
export async function signUpload() {
  const data = await api('/api/me/conversations/uploads/sign', { method: 'POST' });
  return data ?? {};
}

/**
 * Send one file to Cloudinary with the signature the account issued.
 *
 * The file is the form body, so nothing is base64-encoded on the way (which would
 * inflate a picture by a third), and no API secret is involved: a signature is
 * good for exactly the folder and moment it was issued for.
 * @param {File} file
 * @param {{ cloudName: string, apiKey: string, folder: string, timestamp: number, signature: string }} signed
 * @returns {Promise<{ url: string, name: string, kind: string, bytes: number }>}
 */
export async function uploadAttachment(file, signed) {
  const body = new FormData();
  body.append('file', file);
  body.append('api_key', signed.apiKey);
  body.append('timestamp', String(signed.timestamp));
  body.append('folder', signed.folder);
  body.append('signature', signed.signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/auto/upload`, {
    method: 'POST',
    body,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail?.error?.message || 'That file could not be uploaded.');
    error.status = response.status;
    throw error;
  }
  const result = await response.json();
  if (typeof result?.secure_url !== 'string') throw new Error('The upload finished without a link to the file.');
  return { url: result.secure_url, name: file.name, kind: file.type, bytes: file.size };
}

/**
 * Move a chat in the list: hold it at the top, or file it out of the way.
 * @param {string} id
 * @param {{ pinned?: boolean, archived?: boolean }} flags
 */
export async function setConversationFlags(id, flags) {
  const data = await api(`/api/me/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(flags),
  });
  return data?.conversation ?? {};
}
