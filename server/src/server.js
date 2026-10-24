import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { createApp } from './app.js';
import { createRequestListener } from './serve.js';
import { createAuthService, createGoogleVerifier } from './auth.js';
import { createDatabase, createRepository } from './db.js';
import { createDeepSeekClient } from './deepseek.js';
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
const auth = repository && config.googleClientId
  ? createAuthService({ repository, verifyGoogleCredential: createGoogleVerifier(config.googleClientId) })
  : null;
const chatProvider = createDeepSeekClient({ apiKey: config.deepSeekApiKey, endpoint: config.deepSeekEndpoint });
const paystack = createPaystackClient({ secretKey: config.paystackSecretKey, endpoint: config.paystackEndpoint });
const app = createApp({
  auth,
  repository,
  chatProvider,
  defaultModel: config.deepSeekModel,
  paystack,
  paystackSecretKey: config.paystackSecretKey,
  paystackPlanCodes: config.paystackPlanCodes,
  paystackCallbackUrl: config.paystackCallbackUrl,
  googleClientId: config.googleClientId,
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
