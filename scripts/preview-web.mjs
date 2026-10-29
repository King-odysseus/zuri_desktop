// Temporary local preview server for the Zuri Cloud web UI.
// Serves server/public plus sample API responses so the signed-in views can be reviewed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'server', 'public');
// A second preview can run beside the first, so the port is not fixed. The
// signed-in views are reviewed independently of any other agent's session.
const PORT = Number(process.env.PORT) || 8099;
// The web app's own pictures are served too, so a preview shows the same panel a
// visitor sees. Each picture needs its own type: a browser will not draw one sent
// as a generic binary stream, which is what an unlisted extension falls back to.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const plans = [
  { code: 'starter', name: 'Starter', currency: 'NGN', amountKobo: 250000, monthlyTokens: 2000000 },
  { code: 'pro', name: 'Pro', currency: 'NGN', amountKobo: 600000, monthlyTokens: 6000000 },
  { code: 'power', name: 'Power', currency: 'NGN', amountKobo: 1500000, monthlyTokens: 12000000 },
  { code: 'max', name: 'Max', currency: 'NGN', amountKobo: 4000000, monthlyTokens: 40000000 },
];
const usage = { planCode: 'pro', monthlyTokens: 6000000, usedTokens: 4050000, remainingTokens: 1950000, percentUsed: 68, overQuota: false, nearLimit: false };
const subscription = { id: 'sub-1', planCode: 'pro', planName: 'Pro', monthlyTokens: 6000000, currentPeriodStart: '2026-10-01T00:00:00.000Z', currentPeriodEnd: '2026-11-01T00:00:00.000Z' };

// Public picture prices, per plan, as /api/image-prices returns them.
const imagePrices = [
  { code: 'zuri-sketch', name: 'Zuri Sketch', minPlan: 'starter', plans: [{ code: 'starter', priceKobo: 6_000, images: 41 }, { code: 'pro', priceKobo: 4_800, images: 125 }, { code: 'power', priceKobo: 6_000, images: 250 }, { code: 'max', priceKobo: 4_800, images: 833 }] },
  { code: 'zuri-canvas', name: 'Zuri Canvas', minPlan: 'pro', plans: [{ code: 'starter', priceKobo: 33_000, images: 7 }, { code: 'pro', priceKobo: 26_400, images: 22 }, { code: 'power', priceKobo: 33_000, images: 45 }, { code: 'max', priceKobo: 26_400, images: 151 }] },
  { code: 'zuri-studio', name: 'Zuri Studio', minPlan: 'max', plans: [{ code: 'starter', priceKobo: 90_000, images: 2 }, { code: 'pro', priceKobo: 72_000, images: 8 }, { code: 'power', priceKobo: 90_000, images: 16 }, { code: 'max', priceKobo: 72_000, images: 55 }] },
];

// The signed-in model catalogue, with the sample Pro plan's own answer on what it
// may use. The picture models close the same list the chat models open.
const modelCatalogue = [
  { code: 'zuri-flash', name: 'Zuri Flash', kind: 'chat', available: true, minPlan: 'starter' },
  { code: 'zuri-pro', name: 'Zuri Pro', kind: 'chat', available: true, minPlan: 'pro' },
  { code: 'zuri-max', name: 'Zuri Max', kind: 'chat', available: false, minPlan: 'max' },
  { code: 'zuri-code', name: 'Zuri Core', kind: 'chat', available: true, minPlan: 'starter' },
  { code: 'zuri-reason', name: 'Zuri Reason', kind: 'chat', available: true, minPlan: 'pro' },
  { code: 'zuri-elite', name: 'Zuri Elite', kind: 'chat', available: false, minPlan: 'max' },
  { code: 'zuri-sketch', name: 'Zuri Sketch', kind: 'image', available: true, minPlan: 'starter' },
  { code: 'zuri-canvas', name: 'Zuri Canvas', kind: 'image', available: true, minPlan: 'pro' },
  { code: 'zuri-studio', name: 'Zuri Studio', kind: 'image', available: false, minPlan: 'max' },
];

// Sample admin report; PREVIEW_ADMIN=1 makes the sample account an administrator.
const isAdmin = process.env.PREVIEW_ADMIN === '1';
const adminOverview = {
  days: 30, nairaPerUsd: 1600, users: 128, revenueKobo: 18_500_000, costKobo: 4_120_000, marginKobo: 14_380_000,
  models: [
    { code: 'zuri-flash', name: 'Zuri Flash', supplier: 'deepseek', supplierModel: 'deepseek-flash', inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28, quotaWeight: 1, outputQuotaWeight: 1, minPlan: 'starter', rateFactor: 1, isActive: true, sortOrder: 1 },
    { code: 'zuri-pro', name: 'Zuri Pro', supplier: 'moonshot', supplierModel: 'kimi-k3', inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.5, quotaWeight: 5, outputQuotaWeight: 8, minPlan: 'starter', rateFactor: 0.5, isActive: true, sortOrder: 2 },
    { code: 'zuri-max', name: 'Zuri Max', supplier: 'zai', supplierModel: 'glm-5.3', inputUsdPerMillion: 1.5, outputUsdPerMillion: 6, quotaWeight: 12, outputQuotaWeight: 18, minPlan: 'pro', rateFactor: 0.25, isActive: true, sortOrder: 3 },
    { code: 'zuri-code', name: 'Zuri Core', supplier: 'openai', supplierModel: 'gpt-6.1-sol', inputUsdPerMillion: 2, outputUsdPerMillion: 10, quotaWeight: 10, outputQuotaWeight: 30, minPlan: 'pro', rateFactor: 0.4, isActive: true, sortOrder: 4 },
    { code: 'zuri-reason', name: 'Zuri Reason', supplier: 'anthropic', supplierModel: 'claude-sonnet-5-5', inputUsdPerMillion: 2, outputUsdPerMillion: 10, quotaWeight: 10, outputQuotaWeight: 30, minPlan: 'pro', rateFactor: 0.4, isActive: true, sortOrder: 5 },
    { code: 'zuri-elite', name: 'Zuri Elite', supplier: 'anthropic', supplierModel: 'claude-opus-5-5', inputUsdPerMillion: 4, outputUsdPerMillion: 20, quotaWeight: 20, outputQuotaWeight: 60, minPlan: 'max', rateFactor: 0.2, isActive: true, sortOrder: 6 },
    { code: 'zuri-sketch', name: 'Zuri Sketch', kind: 'image', supplier: 'zai', supplierModel: 'cogview-4', usdPerImage: 0.012, quotaTokensPerImage: 48_000, imageQuality: 'standard', inputUsdPerMillion: 0, outputUsdPerMillion: 0, quotaWeight: 1, minPlan: 'starter', rateFactor: 1, isActive: true, sortOrder: 7, supplierCostKoboPerImage: 1_920, priceKoboPerImage: 6_000, pricePlanCode: 'starter', pricePlanName: 'Starter' },
    { code: 'zuri-canvas', name: 'Zuri Canvas', kind: 'image', supplier: 'openai', supplierModel: 'gpt-image-2', usdPerImage: 0.07, quotaTokensPerImage: 264_000, imageQuality: 'medium', inputUsdPerMillion: 0, outputUsdPerMillion: 0, quotaWeight: 5, minPlan: 'pro', rateFactor: 1, isActive: true, sortOrder: 8, supplierCostKoboPerImage: 11_200, priceKoboPerImage: 26_400, pricePlanCode: 'pro', pricePlanName: 'Pro' },
    { code: 'zuri-studio', name: 'Zuri Studio', kind: 'image', supplier: 'openai', supplierModel: 'gpt-image-2', usdPerImage: 0.19, quotaTokensPerImage: 720_000, imageQuality: 'high', inputUsdPerMillion: 0, outputUsdPerMillion: 0, quotaWeight: 12, minPlan: 'max', rateFactor: 1, isActive: true, sortOrder: 9, supplierCostKoboPerImage: 30_400, priceKoboPerImage: 72_000, pricePlanCode: 'max', pricePlanName: 'Max' },
  ],
  spendByModel: [
    { modelCode: 'zuri-pro', requests: 5200, inputTokens: 9_000_000, outputTokens: 3_000_000, quotaTokens: 60_000_000, costMicroUsd: 1_900_000_000, costKobo: 3_040_000 },
    { modelCode: 'zuri-flash', requests: 21000, inputTokens: 40_000_000, outputTokens: 12_000_000, quotaTokens: 52_000_000, costMicroUsd: 675_000_000, costKobo: 1_080_000 },
  ],
  plans: [
    { code: 'starter', name: 'Starter', amountKobo: 250000, monthlyTokens: 2000000, subscribers: 22, limits: { requestsPerMinute: 30, maxConcurrent: 2 } },
    { code: 'pro', name: 'Pro', amountKobo: 600000, monthlyTokens: 6000000, subscribers: 12, limits: { requestsPerMinute: 60, maxConcurrent: 3 } },
    { code: 'power', name: 'Power', amountKobo: 1500000, monthlyTokens: 12000000, subscribers: 3, limits: { requestsPerMinute: 120, maxConcurrent: 4 } },
    { code: 'max', name: 'Max', amountKobo: 4000000, monthlyTokens: 40000000, subscribers: 1, limits: { requestsPerMinute: 240, maxConcurrent: 8 } },
  ],
};

// Sample accounts for the People list, so the plan control can be reviewed. This
// server is a look, not a store: a plan change only edits this array.
const adminUsers = [
  { id: 'u1', email: 'adedayo@example.com', displayName: 'Adedayo Balogun', status: 'active', isAdmin: true, planCode: 'max', planName: 'Max', subscriptionStatus: 'active', periodEnd: '2027-10-28T00:00:00.000Z', usedTokens: 380000, monthlyTokens: 40000000, lastSeenAt: '2026-10-28T08:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'ada@example.com', displayName: 'Ada Obi', status: 'active', isAdmin: false, planCode: 'starter', planName: 'Starter', subscriptionStatus: 'pending', periodEnd: null, usedTokens: 120000, monthlyTokens: 2000000, lastSeenAt: '2026-10-27T18:20:00.000Z' },
  { id: '33333333-3333-4333-8333-333333333333', email: 'musa@example.com', displayName: 'Musa Ibrahim', status: 'suspended', isAdmin: false, planCode: 'pro', planName: 'Pro', subscriptionStatus: 'past_due', periodEnd: '2026-10-01T00:00:00.000Z', usedTokens: 5900000, monthlyTokens: 6000000, lastSeenAt: '2026-10-20T11:05:00.000Z' },
];

// Sample saved chats, so the signed-in chat screen can be reviewed without a
// database. Kept in memory: the preview server is a look, not a store.
let conversations = [
  {
    id: 'c1',
    title: 'Draft a launch email for the starter plan',
    model: 'zuri-pro',
    origin: 'web',
    projectId: 'p1',
    createdAt: '2026-10-24T09:12:00.000Z',
    updatedAt: '2026-10-24T09:40:00.000Z',
    messages: [
      { id: 'm1', role: 'user', content: 'What is wrong with this leaf?', createdAt: '2026-10-24T09:12:00.000Z', attachment: { url: '/zuri-logo.png', name: 'leaf.png', kind: 'image/png', bytes: 2048 } },
      { id: 'm2', role: 'assistant', content: 'Subject: Zuri Starter is here\n\nHi there,\n\nStarter gives you 2 million tokens a month, enough for everyday work, and it costs N2,500.\n\nReply if you would like a walkthrough.', createdAt: '2026-10-24T09:40:00.000Z' },
    ],
  },
  {
    id: 'c2',
    title: 'Why is my reply slow on Power?',
    model: 'zuri-flash',
    origin: 'desktop',
    // Filed nowhere, so the chat history list still shows a thread with no project.
    projectId: null,
    createdAt: '2026-10-23T16:02:00.000Z',
    updatedAt: '2026-10-23T16:05:00.000Z',
    messages: [
      { id: 'm3', role: 'user', content: 'Why is my reply slow on Power?', createdAt: '2026-10-23T16:02:00.000Z' },
      { id: 'm4', role: 'assistant', content: 'Longer answers take longer to stream. Try a shorter question, or pick a faster model.', createdAt: '2026-10-23T16:05:00.000Z' },
    ],
  },
  {
    id: 'c3',
    title: 'New chat',
    model: 'zuri-flash',
    origin: 'web',
    projectId: null,
    createdAt: '2026-10-22T11:00:00.000Z',
    updatedAt: '2026-10-22T11:00:00.000Z',
    messages: [],
  },
];

// Sample projects, so the project screen can be reviewed without a database. As with
// chats, each row keeps its files beside it and a summary helper is what keeps them
// off the wire. In memory only: this server is a look, not a store.
let projects = [
  {
    id: 'p1',
    name: 'Launch plan',
    instructions:
      'Write for a Nigerian small business owner who wants fewer tools, not more. Keep the tone plain and warm, quote prices in naira, and never promise a feature that is not on the pricing page.',
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-24T09:40:00.000Z',
    files: [
      {
        id: 'f1',
        name: 'positioning.md',
        kind: 'text/plain',
        // A text file travels as words rather than bytes, so its size is the length
        // of what it holds and the server reports that instead.
        bytes: 0,
        url: null,
        content:
          'Positioning note\n\nZuri is a Nigerian AI assistant sold monthly in naira.\nThe audience is a small business owner who wants fewer tools, not more.\nLead with the hours saved, then the price.',
        createdAt: '2026-10-20T09:05:00.000Z',
      },
      {
        id: 'f2',
        name: 'launch-hero.png',
        kind: 'image/png',
        bytes: 184_320,
        // A picture's bytes live on the CDN, so only its link is kept here.
        url: '/zuri-logo.png',
        content: '',
        createdAt: '2026-10-21T14:20:00.000Z',
      },
    ],
  },
  // A second project with nothing in it, so the empty instructions, empty file list
  // and empty chat list can all be seen without deleting anything.
  {
    id: 'p2',
    name: 'Thesis notes',
    instructions: '',
    createdAt: '2026-10-18T07:30:00.000Z',
    updatedAt: '2026-10-18T07:30:00.000Z',
    files: [],
  },
];

/** @param {object} row @returns {object} */
function conversationSummary(row) {
  const { messages, ...rest } = row;
  return { ...rest, messageCount: messages.length };
}

/**
 * A project row as the client reads it: the files and the chat count are worked out
 * here rather than stored, so the two counts can never drift from the arrays behind
 * them while the preview is being clicked through.
 * @param {object} row @returns {object}
 */
function projectSummary(row) {
  const { files, ...rest } = row;
  const stored = Array.isArray(files) ? files : [];
  return {
    ...rest,
    fileCount: stored.length,
    conversationCount: conversations.filter((conversation) => conversation.projectId === row.id).length,
  };
}

/**
 * One project file, without its text.
 *
 * The real server sends only the length of a text file, because a list of files has
 * to stay small and the words are read by the chat route rather than every screen.
 * @param {object} row @returns {object}
 */
function projectFileSummary(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind ?? '',
    bytes: Math.max(0, Math.floor(Number(row.bytes) || 0)),
    url: row.url ?? null,
    contentLength: typeof row.content === 'string' ? row.content.length : 0,
    createdAt: row.createdAt,
  };
}

/**
 * The saved-chat endpoints, as the real server serves them, plus a streamed reply
 * so the chat screen can be looked at end to end.
 * @returns {Promise<boolean>} whether the request was handled here
 */
async function conversationRoute(request, response, url) {
  const match = url.pathname.match(/^\/api\/me\/conversations(?:\/([^/]+))?(?:\/(messages))?$/);
  if (!match) return false;
  const [, id, action] = match;
  const found = conversations.find((row) => row.id === id);

  // The signing route, answered without Cloudinary so the chat can be looked at
  // with attachments switched off in this preview.
  if (id === 'uploads' && action === 'sign') {
    json(response, {
      cloudName: '',
      apiKey: '',
      folder: 'zuri/u/preview',
      timestamp: Math.floor(Date.now() / 1000),
      signature: '',
      maxBytes: 10 * 1024 * 1024,
      allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
    });
    return true;
  }

  if (!id && request.method === 'GET') {
    // A project screen asks for one project's chats; without the filter the whole
    // history is listed, which is what the chat list draws. An empty value counts as
    // no filter, the way an unset box on a form does.
    const wanted = (url.searchParams.get('projectId') ?? '').trim();
    const summary = [...conversations]
      .filter((row) => wanted === '' || row.projectId === wanted)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(conversationSummary);
    json(response, { conversations: summary });
    return true;
  }

  if (!id && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    const now = new Date().toISOString();
    const created = {
      id: `c${conversations.length + 1}`,
      title: body.title || 'New chat',
      model: body.model || 'zuri-flash',
      origin: 'web',
      // A chat started from inside a project is filed into it at birth; one started
      // anywhere else belongs to no project, which is null rather than a missing key.
      projectId: typeof body.projectId === 'string' && body.projectId !== '' ? body.projectId : null,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    conversations.push(created);
    json(response, { conversation: conversationSummary(created) });
    return true;
  }

  if (!found) {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'That chat does not exist.' } }));
    return true;
  }

  if (request.method === 'GET' && !action) {
    json(response, { conversation: conversationSummary(found), messages: found.messages });
    return true;
  }

  if (request.method === 'POST' && action === 'messages') {
    const body = JSON.parse(await readBody(request));
    const message = { id: `m${Math.floor(Math.random() * 1e6)}`, role: body.role, content: body.content, attachment: body.attachment ?? null, createdAt: new Date().toISOString() };
    found.messages.push(message);
    found.updatedAt = message.createdAt;
    if (found.title === 'New chat' && body.role === 'user') found.title = body.content.slice(0, 60);
    json(response, { message, conversation: conversationSummary(found) });
    return true;
  }

  if (request.method === 'PATCH') {
    const body = JSON.parse(await readBody(request));
    // The row menu sends whichever field changed, so a title is only replaced when
    // one arrived and the flags keep their value otherwise.
    if (body.pinned !== undefined) found.pinned = body.pinned === true;
    if (body.archived !== undefined) found.archived = body.archived === true;
    if (body.pinned === true && body.archived === undefined) found.archived = false;
    if (body.title !== undefined) found.title = String(body.title || '').trim().slice(0, 60) || found.title;
    // Filing a chat into a project, or taking it out with null, is read by the key
    // being present rather than by its value: null is a real answer here.
    if (body.projectId !== undefined) {
      found.projectId = typeof body.projectId === 'string' && body.projectId !== '' ? body.projectId : null;
    }
    json(response, { conversation: conversationSummary(found) });
    return true;
  }

  if (request.method === 'DELETE') {
    conversations = conversations.filter((row) => row.id !== id);
    json(response, { deleted: true });
    return true;
  }

  return false;
}

// The same caps the real server applies, so a form that is refused here would be
// refused there too rather than saving something production would reject.
const PROJECT_NAME_MAX_LENGTH = 60;
const PROJECT_INSTRUCTIONS_MAX_LENGTH = 4000;
const PROJECT_FILE_TEXT_MAX_LENGTH = 20_000;

/** A trimmed name, or the empty string the caller refuses. @param {unknown} value @returns {string} */
function projectName(value) {
  return String(value ?? '').trim().slice(0, PROJECT_NAME_MAX_LENGTH);
}

/** The instructions as stored: trimmed of trailing space but otherwise kept. @param {unknown} value @returns {string} */
function projectInstructions(value) {
  return String(value ?? '').trim().slice(0, PROJECT_INSTRUCTIONS_MAX_LENGTH);
}

/**
 * The project endpoints, shaped as the real server serves them.
 *
 * A project keeps one set of instructions, a few reference files and the chats filed
 * into it, so opening one is a single answer rather than a request per section. The
 * file text never travels back: only its length does, as production does it.
 * @returns {Promise<boolean>} whether the request was handled here
 */
async function projectRoute(request, response, url) {
  const match = url.pathname.match(/^\/api\/me\/projects(?:\/([^/]+))?(?:\/(files)(?:\/([^/]+))?)?$/);
  if (!match) return false;
  const [, rawId, section, rawFileId] = match;
  const id = rawId ? decodeURIComponent(rawId) : '';
  const fileId = rawFileId ? decodeURIComponent(rawFileId) : '';
  const found = projects.find((row) => row.id === id);
  const isFilesPath = section === 'files' && fileId === '';
  const isOneFilePath = section === 'files' && fileId !== '';

  if (id === '') {
    if (request.method === 'GET') {
      const summary = [...projects]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(projectSummary);
      json(response, { projects: summary });
      return true;
    }
    if (request.method === 'POST') {
      const body = JSON.parse(await readBody(request));
      const name = projectName(body.name);
      if (name === '') {
        fail(response, 400, 'INVALID_MESSAGE', `Give the project a name of 1 to ${PROJECT_NAME_MAX_LENGTH} characters.`);
        return true;
      }
      const now = new Date().toISOString();
      // Counted ids would collide once a project had been deleted, and the screen
      // would then open the wrong one, so the id is taken from the clock instead.
      const created = {
        id: `p${Date.now().toString(36)}`,
        name,
        instructions: projectInstructions(body.instructions),
        createdAt: now,
        updatedAt: now,
        files: [],
      };
      projects.push(created);
      json(response, { project: projectSummary(created) });
      return true;
    }
    fail(response, 405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for the project list.');
    return true;
  }

  if (!found) {
    fail(response, 404, 'PROJECT_NOT_FOUND', 'That project does not exist.');
    return true;
  }

  if (!section && request.method === 'GET') {
    // Only this project's chats travel with it, newest first, so the open project
    // draws its whole screen from one answer.
    const inProject = [...conversations]
      .filter((conversation) => conversation.projectId === found.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(conversationSummary);
    json(response, { project: projectSummary(found), files: found.files.map(projectFileSummary), conversations: inProject });
    return true;
  }

  if (!section && request.method === 'PATCH') {
    const body = JSON.parse(await readBody(request));
    // Only the fields that arrived change, so a rename cannot blank instructions a
    // dialog never showed.
    if (body.name !== undefined) {
      const name = projectName(body.name);
      // A name that was sent but is blank is a refused form, not a rename to nothing.
      if (name === '') {
        fail(response, 400, 'INVALID_MESSAGE', `Give the project a name of 1 to ${PROJECT_NAME_MAX_LENGTH} characters.`);
        return true;
      }
      found.name = name;
    }
    if (body.instructions !== undefined) found.instructions = projectInstructions(body.instructions);
    // The list is ordered by this, and the project somebody just edited is the one
    // they are working in, so it moves to the top.
    found.updatedAt = new Date().toISOString();
    json(response, { project: projectSummary(found) });
    return true;
  }

  if (!section && request.method === 'DELETE') {
    // Its files go with it. Its chats do not vanish: the real server sets their
    // project_id to null, so the work written inside a project returns to the plain
    // history. That is repeated here so the chat list matches what was just deleted.
    projects = projects.filter((row) => row.id !== id);
    for (const conversation of conversations) {
      if (conversation.projectId === id) conversation.projectId = null;
    }
    json(response, { deleted: true });
    return true;
  }

  if (isFilesPath && request.method === 'POST') {
    const body = JSON.parse(await readBody(request));
    const name = String(body.name ?? '').trim().slice(0, 120);
    if (name === '') {
      fail(response, 400, 'INVALID_FILE', 'Give the file a name.');
      return true;
    }
    const bytes = Number(body.bytes);
    const file = {
      id: `f${Math.floor(Math.random() * 1e6)}`,
      name,
      kind: String(body.kind ?? '').slice(0, 120),
      // A text file arrives as words and keeps no byte count, which is why the client
      // falls back to the character count when this is zero.
      bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
      url: typeof body.url === 'string' && body.url !== '' ? body.url : null,
      content: typeof body.content === 'string' ? body.content.slice(0, PROJECT_FILE_TEXT_MAX_LENGTH) : '',
      createdAt: new Date().toISOString(),
    };
    found.files.push(file);
    found.updatedAt = file.createdAt;
    json(response, { file: projectFileSummary(file) });
    return true;
  }

  if (isOneFilePath && request.method === 'DELETE') {
    const before = found.files.length;
    found.files = found.files.filter((file) => file.id !== fileId);
    // A file that was already gone answers like a file that never existed, as the
    // real server does, so a double press is not an error the screen has to explain.
    if (found.files.length === before) {
      fail(response, 404, 'PROJECT_NOT_FOUND', 'That project or file does not exist.');
      return true;
    }
    found.updatedAt = new Date().toISOString();
    json(response, { deleted: true });
    return true;
  }

  fail(response, 405, 'METHOD_NOT_ALLOWED', 'That method is not used for a project or its files.');
  return true;
}

/**
 * A streamed reply in the same event shape the real server sends, so the chat
 * screen's reader is exercised rather than stubbed.
 */
function streamChatRoute(response) {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  const words = ['Here', ' is', ' a', ' sample', ' streamed', ' reply', ' from', ' the', ' preview', ' server', '.'];
  let index = 0;
  const timer = setInterval(() => {
    if (index < words.length) {
      response.write(`data: ${JSON.stringify({ type: 'delta', text: words[index] })}\n\n`);
      index += 1;
      return;
    }
    response.write(`data: ${JSON.stringify({ type: 'done', data: { content: words.join(''), model: 'zuri-flash', modelName: 'Zuri Flash' } })}\n\n`);
    clearInterval(timer);
    response.end();
  }, 40);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

function json(response, data) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: true, data }));
}

/**
 * Refuse a project request in the envelope the client already unwraps, so a screen
 * shows the server's own sentence instead of a status code it cannot explain.
 */
function fail(response, status, code, message) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: false, error: { code, message } }));
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/plans') return json(response, plans);
  if (url.pathname === '/api/image-prices') return json(response, imagePrices);
  if (url.pathname === '/api/admin/overview') return json(response, adminOverview);
  if (url.pathname === '/api/admin/models') return json(response, JSON.parse(await readBody(request)));
  if (url.pathname === '/api/admin/stats') {
    return json(response, {
      accounts: { active: adminUsers.filter((person) => person.status === 'active').length, seenToday: 2, joined: 3, suspended: 1 },
      usage: { requestsToday: 18, tokensToday: 960000, requests: 240, people: 2 },
      subscriptions: { paying: 2, monthlyKobo: 185000 },
      payments: { paid: 4, failed: 1 },
      server: { databaseMs: 6, uptimeSeconds: 86400, environment: 'preview', nodeVersion: process.version },
      daily: [],
      topUsers: [],
    });
  }
  if (url.pathname === '/api/admin/users' && request.method === 'GET') return json(response, { users: adminUsers });
  if (url.pathname.startsWith('/api/admin/users/') && request.method === 'PATCH') {
    const body = JSON.parse(await readBody(request));
    const id = decodeURIComponent(url.pathname.slice('/api/admin/users/'.length));
    const person = adminUsers.find((entry) => entry.id === id);
    if (!person) { response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: { code: 'USER_NOT_FOUND', message: 'That account no longer exists.' } })); return; }
    if (body.action === 'set-plan') {
      const plan = plans.find((entry) => entry.code === body.planCode);
      person.planCode = plan.code;
      person.planName = plan.name;
      person.subscriptionStatus = 'active';
      person.periodEnd = new Date(Date.now() + Number(body.days) * 86400000).toISOString();
    }
    if (body.action === 'suspend') person.status = 'suspended';
    if (body.action === 'restore') person.status = 'active';
    return json(response, { user: person });
  }
  if (url.pathname === '/api/public-config') return json(response, { googleClientId: '' });
  if (url.pathname === '/api/me') return json(response, { user: { id: 'u1', email: 'adedayo@example.com', displayName: 'Adedayo Balogun', status: 'active', isAdmin, createdAt: '2026-08-14T09:20:00.000Z' }, subscription });
  if (url.pathname === '/api/me/usage') return json(response, usage);
  if (url.pathname === '/api/me/limits') return json(response, { planCode: 'pro', limits: { requestsPerMinute: 60, maxConcurrent: 3, maxInputTokens: 32000, maxOutputTokens: 4000 }, usage });
  if (url.pathname === '/api/me/billing') return json(response, {
    subscription: { id: 'sub-1', plan_code: 'pro', status: 'active' },
    payments: [
      { reference: 'ZURI-9F3K21', plan_code: 'pro', amount_kobo: 600000, currency: 'NGN', status: 'success', paid_at: '2026-10-01T08:12:00.000Z' },
      { reference: 'ZURI-7T2M55', plan_code: 'starter', amount_kobo: 250000, currency: 'NGN', status: 'success', paid_at: '2026-09-01T07:45:00.000Z' },
    ],
  });
  if (url.pathname === '/api/billing/checkout') return json(response, { authorizationUrl: '#' });
  if (url.pathname === '/api/models') return json(response, modelCatalogue);
  if (url.pathname === '/api/images' && request.method === 'POST') {
    // A stand-in picture, so a picture drawn in the chat can be reviewed offline.
    const picture = await readFile(path.join(ROOT, 'img', 'app-preview.png'));
    return json(response, {
      requestId: 'preview-picture',
      model: 'zuri-canvas',
      modelName: 'Zuri Canvas',
      mime: 'image/png',
      imageBase64: picture.toString('base64'),
      prompt: 'a stand-in picture from the preview server',
    });
  }

  if (url.pathname === '/api/chat' && request.method === 'POST') { streamChatRoute(response); return; }
  if (await conversationRoute(request, response, url)) return;
  if (await projectRoute(request, response, url)) return;

  // An extensionless path is an app address such as /chat, which the real server
  // answers with the shell; without this the preview 404s on a shared chat link.
  const isAppAddress = path.extname(url.pathname) === '';
  const name = url.pathname === '/' || isAppAddress ? 'index.html' : url.pathname.replace(/^\//, '');
  const filePath = path.resolve(ROOT, name);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(400).end('bad path');
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`preview on http://127.0.0.1:${PORT}`));
