import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { createApp } from './app.js';
import { createRequestListener } from './serve.js';
import { createAuthService, createGoogleVerifier, provisionAdminAccount } from './auth.js';
import { createDatabase, createRepository } from './db.js';
import { createAnthropicClient, createDeepSeekClient } from './deepseek.js';
import { createMailer } from './mail.js';
import { createPaystackClient } from './paystack.js';
import { applySchema } from './schema.js';

const config = readConfig();
const pool = config.databaseUrl ? createDatabase(config.databaseUrl, process.env) : null;
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
const repository = pool ? createRepository(pool) : null;
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
const app = createApp({
  auth,
  repository,
  chatProvider,
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
});

/**
 * Adapt Node's incoming request to the Fetch Request contract used by the app
 * handler. Kept in serve.js so a test can drive it without opening a port on
 * the real configuration.
 */
const serve = createRequestListener({ app, port: config.port });

createServer((request, response) => {
  void serve(request, response);
}).listen(config.port, '0.0.0.0', () => {
  console.log(`[zuri-cloud] listening on ${config.port}`);
});
