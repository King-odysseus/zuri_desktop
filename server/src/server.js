import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { createApp } from './app.js';
import { createRequestListener } from './serve.js';
import { createAuthService, createGoogleVerifier, provisionAdminAccount } from './auth.js';
import { createDatabase, createRepository } from './db.js';
import { createAnthropicClient, createDeepSeekClient } from './deepseek.js';
import { createImageClient } from './images.js';
import { createMailer } from './mail.js';
import { createPaystackClient } from './paystack.js';
import { applySchema } from './schema.js';
import { createAutomationScheduler } from './automations.js';
import { createReminderScheduler } from './reminders.js';
import { searchWeb } from './tools.js';

/**
 * The Office file builders. In the deployed image they sit beside this file (the
 * deploy script copies them in); in a checkout they live in the desktop app's
 * source. Either way there is one copy of the code, and a deployment that has
 * neither simply answers "not switched on" instead of failing to start.
 */
async function loadOfficeBuilder() {
  for (const location of ['./office.js', '../../src/main/office.js']) {
    try {
      const office = await import(location);
      return { build: office.buildOfficeFile, review: office.reviewOfficeContent };
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
        console.error(`[zuri-cloud] office builders at ${location} did not load:`, error?.message ?? error);
      }
    }
  }
  console.log('[zuri-cloud] file making is off: the Office builders were not found');
  return null;
}
import { DEFAULT_MODELS } from './models.js';
import { createPushDelivery } from './push.js';

const config = readConfig();
const pool = config.databaseUrl ? createDatabase(config.databaseUrl, process.env) : null;
const pushDelivery = createPushDelivery(config);
console.log(`[zuri-cloud] push adapters: web=${pushDelivery.configured.web ? 'on' : 'off'}, android=${pushDelivery.configured.android ? 'on' : 'off'}, windows=${pushDelivery.configured.windows ? 'on' : 'off'}`);
if (pool) {
  // Applying the schema here means a fresh Railway Postgres is usable on the first
  // boot without a separate migration step. A failure is logged rather than thrown:
  // the health endpoint should still answer so the deploy is not marked crashed,
  // while the database-backed routes report the real error.
  try {
    const { plans } = await applySchema(pool);
    console.log(`[zuri-cloud] schema ready; ${plans.length} plans: ${plans.join(', ')}`);
  } catch (error) {
    console.error('[zuri-cloud] schema setup failed:', error?.message ?? error);
  }
}
const repository = pool ? createRepository(pool, { pushDelivery }) : null;
// Password accounts need no Google client, so the auth service exists whenever
// there is a database; Google sign-in is simply unavailable without a client id.
const auth = repository
  ? createAuthService({
    repository,
    verifyGoogleCredential: config.googleClientId ? createGoogleVerifier(config.googleClientId) : null,
  })
  : null;
// The first administrator comes from ADMIN_EMAIL rather than from a SQL console. A
// failure is logged, not thrown, for the same reason a schema failure is: the API
// should still start, and the real error reaches whoever tries to sign in.
if (repository) {
  try {
    const adminSetup = await provisionAdminAccount({ repository, email: config.adminEmail, password: config.adminPassword });
    if (adminSetup.skipped) {
      // Quiet on a deployment that never asked for an administrator.
      if (config.adminEmail !== '') console.log(`[zuri-cloud] admin account not set up: ${adminSetup.skipped}`);
    } else {
      const note = adminSetup.passwordSet ? '' : '; no password set, so sign in with Google or set ADMIN_PASSWORD';
      console.log(`[zuri-cloud] admin account ready for ${adminSetup.user.email}: ${adminSetup.created ? 'created' : 'existing account promoted'}${note}`);
    }
  } catch (error) {
    console.error('[zuri-cloud] admin account setup failed:', error?.message ?? error);
  }
}
// One client per supplier that has a key. A Zuri model names its supplier, and a
// model whose supplier has no key fails with a clear error instead of falling
// back to a different (and differently priced) supplier.
const supplierClients = {
  deepseek: createDeepSeekClient({ apiKey: config.deepSeekApiKey, endpoint: config.deepSeekEndpoint }),
  moonshot: createDeepSeekClient({ apiKey: config.moonshotApiKey, endpoint: 'https://api.moonshot.ai/v1/chat/completions' }),
  zai: createDeepSeekClient({ apiKey: config.zaiApiKey, endpoint: 'https://api.z.ai/api/paas/v4/chat/completions' }),
  openai: createDeepSeekClient({ apiKey: config.openaiApiKey, endpoint: 'https://api.openai.com/v1/chat/completions' }),
  anthropic: createAnthropicClient({ apiKey: config.anthropicApiKey }),
};
const chatProvider = async (request) => {
  const client = supplierClients[request.supplier];
  if (!client) {
    const error = new Error('This model is not switched on yet.');
    error.code = 'PROVIDER_REQUEST_FAILED';
    throw error;
  }
  return client(request);
};
const paystack = createPaystackClient({ secretKey: config.paystackSecretKey, endpoint: config.paystackEndpoint });
const mailer = createMailer({ apiKey: config.brevoApiKey, from: config.mailFrom, fromName: config.mailFromName });
if (!mailer.configured) console.log('[zuri-cloud] password reset email is off: BREVO_API_KEY and MAIL_FROM are not both set');
const officeBuilder = await loadOfficeBuilder();
const app = createApp({
  auth,
  repository,
  chatProvider,
  officeBuilder,
  nairaPerUsd: config.nairaPerUsd,
  paystack,
  paystackSecretKey: config.paystackSecretKey,
  paystackPlanCodes: config.paystackPlanCodes,
  paystackCallbackUrl: config.paystackCallbackUrl,
  // Attachments: the app only ever signs, so these three values are all it needs.
  cloudinary: {
    cloudName: config.cloudinaryCloudName,
    apiKey: config.cloudinaryApiKey,
    apiSecret: config.cloudinaryApiSecret,
  },
  googleClientId: config.googleClientId,
  mailer,
  // A reset link has to be absolute, so an unset SITE_URL falls back to the
  // service's own URL rather than producing a dead relative link.
  siteUrl: config.siteUrl || config.cloudUrl,
  // Capacitor serves the bundled Android dashboard from https://localhost.
  // Keep this list narrow so the API is not opened to arbitrary browser origins.
  corsOrigins: ['https://localhost', 'capacitor://localhost'],
  pushVapidPublicKey: config.vapidPublicKey,
});

/**
 * Adapt Node's incoming request to the Fetch Request contract used by the app
 * handler. Kept in serve.js so a test can drive it without opening a port on
 * the real configuration.
 */
const serve = createRequestListener({ app, port: config.port });

/**
 * The automation sweep: the part of this service that acts without being asked.
 *
 * It needs a database, so a deployment without one simply has no scheduler and its
 * automation routes answer "not configured". It is started after the port is open
 * rather than before, because Railway reads the open port as the service being up
 * and a slow first sweep should not hold that back.
 */
const automations = repository
  ? createAutomationScheduler({
    repository,
    chatProvider,
    searchWeb,
    mailer,
    loadModels: () => (typeof repository.listModels === 'function'
      ? repository.listModels()
      : Promise.resolve(DEFAULT_MODELS.map((model) => ({ ...model })))),
  })
  : null;
const reminders = repository ? createReminderScheduler({ repository }) : null;

createServer((request, response) => {
  void serve(request, response);
}).listen(config.port, '0.0.0.0', () => {
  console.log(`[zuri-cloud] listening on ${config.port}`);
  if (!automations) {
    console.log('[zuri-cloud] automations are off: there is no database to read them from');
  } else {
    // A deploy restarts this process, so the cloud sweep is the part that keeps
    // scheduled work alive while every client is closed.
    automations
      .rearm()
      .then((repaired) => {
        if (repaired > 0) console.log(`[zuri-cloud] re-armed ${repaired} automation(s) left mid-run by a restart`);
      })
      .catch((error) => console.error('[zuri-cloud] automation re-arm failed:', error?.message ?? error));
    automations.start();
    console.log('[zuri-cloud] automation sweep started');
  }
  if (reminders) {
    reminders.start();
    console.log('[zuri-cloud] reminder notification sweep started');
  }
});
