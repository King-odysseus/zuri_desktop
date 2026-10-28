import pg from 'pg';
import { QUOTA_WINDOW_HOURS, windowTokensForPlan } from './limits.js';
import { findTopupPack, TOPUP_VALID_DAYS } from './topups.js';

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {object} value @returns {object} */
function publicUser(value) {
  return {
    id: value.id,
    email: value.email,
    displayName: value.display_name,
    status: value.status,
    isAdmin: value.is_admin === true,
    // A Google-only account has no hash, which is how the sign-in screen knows to
    // offer Google instead of a password box.
    hasPassword: typeof value.password_hash === 'string' && value.password_hash !== '',
    createdAt: value.created_at,
  };
}

/** @param {object} row @returns {object} */
function publicModelRow(row) {
  return {
    code: row.code,
    name: row.name,
    supplier: row.supplier,
    supplierModel: row.supplier_model,
    kind: row.kind === 'image' ? 'image' : 'text',
    inputUsdPerMillion: Number(row.input_usd_per_million),
    outputUsdPerMillion: Number(row.output_usd_per_million),
    usdPerImage: Number(row.usd_per_image) || 0,
    quotaTokensPerImage: Number(row.quota_tokens_per_image) || 0,
    imageQuality: typeof row.image_quality === 'string' ? row.image_quality : '',
    quotaWeight: Number(row.quota_weight),
    // 0 means "charge replies at the prompt's weight", which is how a row seeded
    // before the split still behaves.
    outputQuotaWeight: Number(row.output_quota_weight) || 0,
    minPlan: row.min_plan,
    rateFactor: Number(row.rate_factor),
    isActive: row.is_active === true,
    sortOrder: row.sort_order,
  };
}

// History is bounded per account so one customer cannot fill the database, and per
// conversation so a single thread stays loadable in one response.
export const CONVERSATION_LIMIT = 200;
export const MESSAGE_LIMIT = 500;
export const CONVERSATION_LIST_LIMIT = 100;

// Postgres raises 22P02 for an id that is not a uuid, which a handler would report as
// a server fault. A caller that invents an id should learn nothing, so a malformed id
// is answered exactly like a missing one and never reaches the database.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} value @returns {boolean} */
function isUuid(value) {
  return UUID_PATTERN.test(text(value));
}

// The message count travels with each conversation row, so the list is one query
// rather than one query per thread.
const CONVERSATION_COLUMNS =
  'SELECT c.id, c.title, c.model, c.origin, c.created_at, c.updated_at, COUNT(m.id)::INT AS message_count ' +
  'FROM conversations c LEFT JOIN conversation_messages m ON m.conversation_id = c.id ';

/** @param {object} row @returns {object} */
function publicConversation(row) {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    origin: row.origin,
    messageCount: Number(row.message_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @param {object} row @returns {object} */
function publicConversationMessage(row) {
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at };
}

/** @param {string} connectionString @param {NodeJS.ProcessEnv} [environment] @returns {import('pg').Pool} */
export function createDatabase(connectionString, environment = process.env) {
  return new pg.Pool({
    connectionString,
    ssl: environment.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

/** @param {import('pg').Pool} pool @returns {object} */
export function createRepository(pool) {
  /**
   * New accounts need a subscription row so checkout can be started, but the row stays
   * pending until Paystack confirms payment. Pending accounts cannot reserve usage.
   * @param {import('pg').PoolClient} client
   * @param {string} userId
   */
  async function ensureStarterSubscription(client, userId) {
    await client.query(
      'INSERT INTO subscriptions (user_id, plan_code, status, current_period_start, current_period_end) ' +
      "SELECT $1, 'starter', 'pending', NOW(), NOW() + INTERVAL '1 month' " +
      "WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id = $1 AND status IN ('pending', 'active', 'past_due'))",
      [userId],
    );
  }

  return {
    async findOrCreateGoogleUser(profile) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let result = await client.query('SELECT * FROM users WHERE google_subject = $1 OR email = $2 LIMIT 1', [profile.googleSubject, profile.email]);
        let user = result.rows[0];
        if (!user) {
          result = await client.query(
            'INSERT INTO users (email, display_name, google_subject) VALUES ($1, $2, $3) RETURNING *',
            [profile.email, profile.displayName, profile.googleSubject],
          );
          user = result.rows[0];
        } else {
          if (user.google_subject && user.google_subject !== profile.googleSubject) {
            const error = new Error('That email is linked to another sign-in identity.');
            error.code = 'IDENTITY_CONFLICT';
            throw error;
          }
          result = await client.query(
            "UPDATE users SET google_subject = COALESCE(google_subject, $1), display_name = CASE WHEN $2 <> '' THEN $2 ELSE display_name END, last_seen_at = NOW() WHERE id = $3 RETURNING *",
            [profile.googleSubject, profile.displayName, user.id],
          );
          user = result.rows[0];
        }
        await ensureStarterSubscription(client, user.id);
        await client.query('COMMIT');
        return publicUser(user);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createSession(userId, tokenHash, expiresAt) {
      await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
    },
    /**
     * Resolve a bearer token to its user and treat the call as activity.
     *
     * The lookup is the only place a session is refreshed: revoked rows, rows past
     * expires_at and rows idle for longer than the window match nothing, so a stale
     * token can never be extended back to life. The session timestamps come back as
     * they were read, before the touch, so the caller can apply the idle rule again.
     * @param {string} tokenHash
     * @param {{ now?: Date, idleTtlMs?: number }} [options]
     */
    async findSessionUser(tokenHash, { now = new Date(), idleTtlMs = 3 * 24 * 60 * 60 * 1000 } = {}) {
      const at = now instanceof Date ? now : new Date(now);
      const idleSince = new Date(at.getTime() - idleTtlMs);
      const nextExpiry = new Date(at.getTime() + idleTtlMs);
      const result = await pool.query(
        'SELECT u.*, s.id AS session_id, s.last_used_at AS session_last_used_at, s.expires_at AS session_expires_at, ' +
        's2.id AS subscription_id, s2.plan_code, s2.status AS subscription_status, s2.current_period_start, s2.current_period_end, p.name AS plan_name, p.monthly_tokens ' +
        'FROM sessions s JOIN users u ON u.id = s.user_id ' +
        "JOIN subscriptions s2 ON s2.user_id = u.id AND s2.status IN ('pending', 'active', 'past_due') " +
        'JOIN plans p ON p.code = s2.plan_code ' +
        "WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND s.last_used_at >= $3 AND u.status = 'active' LIMIT 1",
        [tokenHash, at, idleSince],
      );
      const row = result.rows[0];
      if (!row) return null;
      await pool.query('UPDATE sessions SET last_used_at = $2, expires_at = $3 WHERE id = $1', [row.session_id, at, nextExpiry]);
      await pool.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [row.id, at]);
      return {
        user: publicUser(row),
        subscription: {
          id: row.subscription_id,
          planCode: row.plan_code,
          planName: row.plan_name,
          status: row.subscription_status,
          monthlyTokens: Number(row.monthly_tokens),
          currentPeriodStart: row.current_period_start,
          currentPeriodEnd: row.current_period_end,
        },
        session: { lastUsedAt: row.session_last_used_at, expiresAt: row.session_expires_at },
      };
    },
    async createUserWithPassword({ email, passwordHash, displayName }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let result;
        try {
          result = await client.query(
            'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING *',
            [email, displayName ?? '', passwordHash],
          );
        } catch (error) {
          // users.email is unique and google_subject is never set here, so a unique
          // violation means the address is taken: a normal answer, not a fault.
          if (error?.code === '23505') {
            const taken = new Error('An account with that email address already exists.');
            taken.code = 'EMAIL_TAKEN';
            throw taken;
          }
          throw error;
        }
        const user = result.rows[0];
        await ensureStarterSubscription(client, user.id);
        await client.query('COMMIT');
        return publicUser(user);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    /**
     * @param {string} email Already normalized by the caller.
     * @returns {Promise<{ user: object, passwordHash: string } | null>}
     */
    async findUserByEmail(email) {
      const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
      const row = result.rows[0];
      if (!row) return null;
      // The hash stays beside publicUser, never inside it, so it cannot leak into a
      // response by accident.
      return { user: publicUser(row), passwordHash: typeof row.password_hash === 'string' ? row.password_hash : '' };
    },
    async updatePasswordHash(userId, passwordHash) {
      const result = await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id', [userId, passwordHash]);
      if (result.rowCount === 0) {
        const error = new Error('That account no longer exists.');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }
    },
    /**
     * Create the administrator account, or promote the one that already exists.
     *
     * One statement rather than a read then a write, so two boots racing each other
     * cannot both insert: the loser lands on the conflict clause. An empty
     * passwordHash keeps whatever hash the row holds. A new account also gets the
     * Administrators still receive a pending Starter row so the account has a
     * consistent billing record; admin routes do not require paid chat access.
     * @param {{ email: string, passwordHash?: string }} request Email normalised by the caller.
     * @returns {Promise<object>} The public user, carrying isAdmin.
     */
    async ensureAdminAccount({ email, passwordHash = '' }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          "INSERT INTO users (email, password_hash, is_admin) VALUES ($1, NULLIF($2, ''), TRUE) " +
          "ON CONFLICT (email) DO UPDATE SET is_admin = TRUE, password_hash = COALESCE(NULLIF($2, ''), users.password_hash) " +
          'RETURNING *',
          [email, passwordHash],
        );
        const user = result.rows[0];
        await ensureStarterSubscription(client, user.id);
        await client.query('COMMIT');
        return publicUser(user);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createPasswordReset({ userId, tokenHash, expiresAt }) {
      await pool.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
    },
    /**
     * Single-use in one statement: the update only matches an unused, unexpired row,
     * so two racing requests cannot both consume the same token.
     * @param {string} tokenHash
     * @returns {Promise<string | null>} The user id, or null when the token is spent.
     */
    async consumePasswordReset(tokenHash) {
      const result = await pool.query(
        'UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id',
        [tokenHash],
      );
      return result.rows[0]?.user_id ?? null;
    },
    async revokeUserSessions(userId) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    },
    async getUsage(userId, periodStart, subscription) {
      const result = await pool.query(
        'SELECT COALESCE(SUM(COALESCE(quota_tokens, total_tokens)), 0)::BIGINT AS used_tokens FROM usage_events ' +
        'WHERE user_id = $1 AND created_at >= $2 AND created_at < $3',
        [userId, periodStart, subscription.currentPeriodEnd],
      );
      // The window is measured separately because it spans period boundaries:
      // the last five hours do not care where the billing month starts.
      const windowResult = await pool.query(
        "SELECT COALESCE(SUM(COALESCE(quota_tokens, total_tokens)), 0)::BIGINT AS used_tokens, MIN(created_at) AS oldest_at FROM usage_events WHERE user_id = $1 AND created_at > NOW() - ($2::INT * INTERVAL '1 hour')",
        [userId, QUOTA_WINDOW_HOURS],
      );
      const creditResult = await pool.query(
        'SELECT COALESCE(SUM(tokens), 0)::BIGINT AS tokens FROM usage_credits WHERE user_id = $1 AND expires_at > NOW()',
        [userId],
      );
      return {
        usedTokens: Number(result.rows[0]?.used_tokens ?? 0),
        windowUsedTokens: Number(windowResult.rows[0]?.used_tokens ?? 0),
        windowOldestAt: windowResult.rows[0]?.oldest_at ?? null,
        creditTokens: Number(creditResult.rows[0]?.tokens ?? 0),
        subscription,
      };
    },
    async reserveUsage({ userId, subscriptionId, requestedTokens, expiresAt }) {
      const requested = Number(requestedTokens);
      if (!Number.isSafeInteger(requested) || requested < 1) {
        const error = new Error('The requested token reservation is invalid.');
        error.code = 'INVALID_TOKEN_RESERVATION';
        throw error;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const subscriptionResult = await client.query(
          "SELECT s.id, s.plan_code, s.current_period_start, s.current_period_end, p.monthly_tokens FROM subscriptions s JOIN plans p ON p.code = s.plan_code WHERE s.id = $1 AND s.user_id = $2 AND s.status IN ('active', 'past_due') FOR UPDATE",
          [subscriptionId, userId],
        );
        const subscription = subscriptionResult.rows[0];
        if (!subscription) {
          const error = new Error('The subscription is no longer active.');
          error.code = 'SUBSCRIPTION_NOT_ACTIVE';
          throw error;
        }
        await client.query(
          "UPDATE usage_reservations SET status = 'released' WHERE user_id = $1 AND status = 'reserved' AND expires_at <= NOW()",
          [userId],
        );
        const usageResult = await client.query(
          "SELECT COALESCE((SELECT SUM(COALESCE(quota_tokens, total_tokens)) FROM usage_events WHERE user_id = $1 AND created_at >= $2 AND created_at < $3), 0) + COALESCE((SELECT SUM(reserved_tokens) FROM usage_reservations WHERE user_id = $1 AND subscription_id = $4 AND status = 'reserved' AND expires_at > NOW()), 0) AS committed_tokens",
          [userId, subscription.current_period_start, subscription.current_period_end, subscription.id],
        );
        const committedTokens = Number(usageResult.rows[0]?.committed_tokens ?? 0);
        // Purchased tokens raise the ceiling for this period. They expire on
        // their own clock, so the filter is on expires_at, not on the period.
        const creditResult = await client.query(
          'SELECT COALESCE(SUM(tokens), 0)::BIGINT AS tokens FROM usage_credits WHERE user_id = $1 AND expires_at > NOW()',
          [userId],
        );
        const creditTokens = Number(creditResult.rows[0]?.tokens ?? 0) || 0;
        const allowance = Number(subscription.monthly_tokens) + creditTokens;
        if (!Number.isSafeInteger(committedTokens) || committedTokens + requested > allowance) {
          const error = new Error('This request would exceed the plan quota.');
          error.code = 'QUOTA_EXCEEDED';
          throw error;
        }
        // The same request on the short clock. Reservations still inside the
        // window count as spent, so a burst of parallel requests cannot slip
        // past the ceiling before any of them records its usage.
        const windowResult = await client.query(
          "SELECT COALESCE((SELECT SUM(COALESCE(quota_tokens, total_tokens)) FROM usage_events WHERE user_id = $1 AND created_at > NOW() - ($3::INT * INTERVAL '1 hour')), 0) + COALESCE((SELECT SUM(reserved_tokens) FROM usage_reservations WHERE user_id = $1 AND subscription_id = $2 AND status = 'reserved' AND expires_at > NOW() AND created_at > NOW() - ($3::INT * INTERVAL '1 hour')), 0) AS window_tokens, (SELECT MIN(created_at) FROM usage_events WHERE user_id = $1 AND created_at > NOW() - ($3::INT * INTERVAL '1 hour')) AS oldest_at",
          [userId, subscription.id, QUOTA_WINDOW_HOURS],
        );
        const windowCommitted = Number(windowResult.rows[0]?.window_tokens ?? 0) || 0;
        const windowAllowance = windowTokensForPlan(subscription.plan_code) + creditTokens;
        if (windowCommitted + requested > windowAllowance) {
          // The window frees up when its oldest event ages out, so that is the
          // earliest moment a refused request can succeed.
          const oldestAt = windowResult.rows[0]?.oldest_at ? new Date(windowResult.rows[0].oldest_at).getTime() : 0;
          const error = new Error('This request needs more than the ' + QUOTA_WINDOW_HOURS + '-hour allowance has left. Try again once older usage leaves the window.');
          error.code = 'WINDOW_EXCEEDED';
          error.retryAfterSeconds = oldestAt > 0
            ? Math.max(60, Math.ceil((oldestAt + QUOTA_WINDOW_HOURS * 3_600_000 - Date.now()) / 1000))
            : 300;
          throw error;
        }
        const reservationResult = await client.query(
          "INSERT INTO usage_reservations (user_id, subscription_id, reserved_tokens, status, expires_at) VALUES ($1, $2, $3, 'reserved', $4) RETURNING id",
          [userId, subscription.id, requested, expiresAt],
        );
        await client.query('COMMIT');
        return { id: reservationResult.rows[0].id, reservedTokens: requested };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async commitUsage({ reservationId, userId, model, inputTokens, outputTokens, requestId, modelCode = null, quotaTokens = null, costMicroUsd = 0, supplier = 'deepseek' }) {
      const input = Number(inputTokens);
      const output = Number(outputTokens);
      if (![input, output].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        const error = new Error('The provider usage total is invalid.');
        error.code = 'INVALID_PROVIDER_USAGE';
        throw error;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const reservationResult = await client.query(
          'SELECT id, subscription_id, reserved_tokens, status FROM usage_reservations WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [reservationId, userId],
        );
        const reservation = reservationResult.rows[0];
        if (!reservation) throw new Error('The usage reservation was not found.');
        if (reservation.status === 'committed') {
          await client.query('COMMIT');
          return;
        }
        if (reservation.status !== 'reserved') throw new Error('The usage reservation is no longer available.');
        const counted = Number.isSafeInteger(quotaTokens) ? quotaTokens : input + output;
        if (counted > Number(reservation.reserved_tokens)) {
          const error = new Error('The provider usage exceeded the reserved budget.');
          error.code = 'RESERVATION_EXCEEDED';
          throw error;
        }
        await client.query(
          'INSERT INTO usage_events (user_id, subscription_id, provider, model, model_code, input_tokens, output_tokens, quota_tokens, cost_micro_usd, request_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [userId, reservation.subscription_id, supplier, model, modelCode, input, output, counted, costMicroUsd, requestId],
        );
        await client.query("UPDATE usage_reservations SET status = 'committed', committed_at = NOW() WHERE id = $1", [reservation.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async listModels() {
      const result = await pool.query('SELECT * FROM models ORDER BY sort_order, code');
      return result.rows.map(publicModelRow);
    },
    async saveModel(model) {
      const result = await pool.query(
        'INSERT INTO models (code, name, supplier, supplier_model, kind, usd_per_image, quota_tokens_per_image, image_quality, input_usd_per_million, output_usd_per_million, quota_weight, output_quota_weight, min_plan, rate_factor, is_active, sort_order) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ' +
        'ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, supplier = EXCLUDED.supplier, supplier_model = EXCLUDED.supplier_model, kind = EXCLUDED.kind, ' +
        'usd_per_image = EXCLUDED.usd_per_image, quota_tokens_per_image = EXCLUDED.quota_tokens_per_image, image_quality = EXCLUDED.image_quality, ' +
        'input_usd_per_million = EXCLUDED.input_usd_per_million, output_usd_per_million = EXCLUDED.output_usd_per_million, quota_weight = EXCLUDED.quota_weight, output_quota_weight = EXCLUDED.output_quota_weight, ' +
        'min_plan = EXCLUDED.min_plan, rate_factor = EXCLUDED.rate_factor, is_active = EXCLUDED.is_active, sort_order = EXCLUDED.sort_order, updated_at = NOW() RETURNING *',
        [model.code, model.name, model.supplier, model.supplierModel, model.kind ?? 'text', model.usdPerImage ?? 0, model.quotaTokensPerImage ?? 0, model.imageQuality ?? '', model.inputUsdPerMillion, model.outputUsdPerMillion, model.quotaWeight, model.outputQuotaWeight ?? 0, model.minPlan, model.rateFactor, model.isActive, model.sortOrder],
      );
      return publicModelRow(result.rows[0]);
    },
    /** Spend, revenue and customers for the admin dashboard; `days` is the look-back window. */
    async adminOverview(days = 30) {
      const window = Math.min(366, Math.max(1, Math.floor(Number(days) || 30)));
      const [byModel, plans, revenue, totals] = await Promise.all([
        pool.query(
          "SELECT COALESCE(model_code, model) AS model_code, COUNT(*)::INT AS requests, COALESCE(SUM(input_tokens), 0)::BIGINT AS input_tokens, " +
          "COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens, COALESCE(SUM(quota_tokens), 0)::BIGINT AS quota_tokens, COALESCE(SUM(cost_micro_usd), 0)::BIGINT AS cost_micro_usd " +
          "FROM usage_events WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL GROUP BY 1 ORDER BY 6 DESC",
          [String(window)],
        ),
        pool.query(
          "SELECT p.code, p.name, p.amount_kobo, p.monthly_tokens, COUNT(s.id)::INT AS subscribers FROM plans p " +
          "LEFT JOIN subscriptions s ON s.plan_code = p.code AND s.status IN ('active', 'past_due') GROUP BY p.code ORDER BY p.amount_kobo",
        ),
        pool.query(
          "SELECT COALESCE(SUM(amount_kobo), 0)::BIGINT AS revenue_kobo FROM payments WHERE status = 'success' AND paid_at >= NOW() - ($1 || ' days')::INTERVAL",
          [String(window)],
        ),
        pool.query("SELECT COUNT(*)::INT AS users FROM users WHERE status = 'active'"),
      ]);
      return {
        days: window,
        users: totals.rows[0]?.users ?? 0,
        revenueKobo: Number(revenue.rows[0]?.revenue_kobo ?? 0),
        byModel: byModel.rows.map((row) => ({
          modelCode: row.model_code,
          requests: row.requests,
          inputTokens: Number(row.input_tokens),
          outputTokens: Number(row.output_tokens),
          quotaTokens: Number(row.quota_tokens),
          costMicroUsd: Number(row.cost_micro_usd),
        })),
        plans: plans.rows.map((row) => ({ code: row.code, name: row.name, amountKobo: Number(row.amount_kobo), monthlyTokens: Number(row.monthly_tokens), subscribers: row.subscribers })),
      };
    },
    async releaseUsage(reservationId, userId) {
      await pool.query("UPDATE usage_reservations SET status = 'released' WHERE id = $1 AND user_id = $2 AND status = 'reserved'", [reservationId, userId]);
    },
    async createPayment({ userId, planCode = null, reference, amountKobo, kind = 'subscription', packCode = null, tokensGranted = null }) {
      // plan_code is null for a top-up: buying tokens does not change plan, so
      // the checkout fills kind, pack_code and tokens_granted instead.
      const result = await pool.query(
        "INSERT INTO payments (user_id, plan_code, reference, amount_kobo, currency, status, kind, pack_code, tokens_granted) VALUES ($1, $2, $3, $4, 'NGN', 'initialized', $5, $6, $7) RETURNING id, reference, status",
        [userId, planCode, reference, amountKobo, kind, packCode, tokensGranted],
      );
      return result.rows[0];
    },
    async markPaymentFailed(reference, rawEvent) {
      await pool.query("UPDATE payments SET status = 'failed', raw_event = $2 WHERE reference = $1 AND status = 'initialized'", [reference, rawEvent]);
    },
    async applySuccessfulPayment({ reference, transaction }) {
      const amount = Number(transaction?.amount);
      const transactionReference = typeof transaction?.reference === 'string' ? transaction.reference : '';
      if (transactionReference !== reference || transaction?.status !== 'success' || !Number.isSafeInteger(amount) || amount < 1 || transaction?.currency !== 'NGN') {
        const error = new Error('Paystack did not confirm this payment.');
        error.code = 'PAYMENT_NOT_CONFIRMED';
        throw error;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const paymentResult = await client.query(
          'SELECT p.*, u.email FROM payments p JOIN users u ON u.id = p.user_id WHERE p.reference = $1 FOR UPDATE',
          [reference],
        );
        const payment = paymentResult.rows[0];
        if (!payment) {
          const error = new Error('The payment reference was not found.');
          error.code = 'PAYMENT_NOT_FOUND';
          throw error;
        }
        if (payment.status === 'success') {
          await client.query('COMMIT');
          return { applied: false, planCode: payment.plan_code };
        }
        if (Number(payment.amount_kobo) !== amount || text(transaction?.customer?.email).toLowerCase() !== text(payment.email).toLowerCase()) {
          const error = new Error('The payment details do not match the checkout.');
          error.code = 'PAYMENT_DETAILS_MISMATCH';
          throw error;
        }
        const customerCode = text(transaction?.customer?.customer_code);
        const authorizationCode = text(transaction?.authorization?.authorization_code);
        const subscriptionCode = text(transaction?.subscription_code);
        await client.query(
          "UPDATE payments SET status = 'success', paystack_transaction_id = $2, paystack_customer_code = $3, paystack_authorization_code = $4, paystack_subscription_code = $5, raw_event = $6, paid_at = NOW() WHERE id = $1",
          [payment.id, transaction.id ?? null, customerCode || null, authorizationCode || null, subscriptionCode || null, transaction],
        );
        // A pack is granted once: the payment row was locked above, and a
        // payment that had already succeeded returned before this point.
        if (payment.kind === 'topup') {
          const tokens = Number(payment.tokens_granted);
          if (!Number.isSafeInteger(tokens) || tokens < 1 || !payment.pack_code) {
            const error = new Error('This top-up has no token count.');
            error.code = 'PAYMENT_DETAILS_MISMATCH';
            throw error;
          }
          await client.query(
            "INSERT INTO usage_credits (user_id, payment_id, pack_code, tokens, expires_at) VALUES ($1, $2, $3, $4, NOW() + ($5::INT * INTERVAL '1 day'))",
            [payment.user_id, payment.id, payment.pack_code, tokens, TOPUP_VALID_DAYS],
          );
          await client.query('COMMIT');
          return { applied: true, planCode: null, packCode: payment.pack_code, tokensGranted: tokens };
        }
        await client.query(
          "UPDATE subscriptions SET plan_code = $2, status = 'active', current_period_start = NOW(), current_period_end = NOW() + INTERVAL '1 month', paystack_customer_code = COALESCE($3, paystack_customer_code), paystack_authorization_code = COALESCE($4, paystack_authorization_code), paystack_subscription_code = COALESCE($5, paystack_subscription_code), updated_at = NOW() WHERE user_id = $1 AND status IN ('pending', 'active', 'past_due')",
          [payment.user_id, payment.plan_code, customerCode || null, authorizationCode || null, subscriptionCode || null],
        );
        await client.query('COMMIT');
        return { applied: true, planCode: payment.plan_code };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async updateSubscriptionFromPaystack(event) {
      const data = event?.data ?? {};
      const subscriptionCode = text(data.subscription_code ?? data.subscription?.subscription_code);
      const customerCode = text(data.customer?.customer_code);
      const email = text(data.customer?.email).toLowerCase();
      if (subscriptionCode === '' && customerCode === '' && email === '') return { applied: false };
      const status = event.event === 'invoice.payment_failed' ? 'past_due' : event.event === 'subscription.disable' ? 'expired' : event.event === 'subscription.not_renew' ? 'cancelled' : 'active';
      const periodSql = event.event === 'charge.success'
        ? ", current_period_start = NOW(), current_period_end = NOW() + INTERVAL '1 month'"
        : '';
      const result = await pool.query(
        `UPDATE subscriptions s SET status = $1, paystack_subscription_code = COALESCE($2, s.paystack_subscription_code), paystack_customer_code = COALESCE($3, s.paystack_customer_code), updated_at = NOW()${periodSql} FROM users u WHERE s.user_id = u.id AND s.status IN ('active', 'past_due') AND ($2 IS NOT NULL AND s.paystack_subscription_code = $2 OR $3 IS NOT NULL AND s.paystack_customer_code = $3 OR $4 <> '' AND u.email = $4) RETURNING s.id`,
        [status, subscriptionCode || null, customerCode || null, email],
      );
      return { applied: result.rowCount > 0 };
    },
    async getBilling(userId) {
      const subscriptionResult = await pool.query(
        'SELECT s.id, s.plan_code, s.status, s.current_period_start, s.current_period_end, s.paystack_subscription_code, p.name AS plan_name, p.monthly_tokens FROM subscriptions s JOIN plans p ON p.code = s.plan_code WHERE s.user_id = $1 AND s.status IN (\'pending\', \'active\', \'past_due\', \'cancelled\') ORDER BY s.updated_at DESC LIMIT 1',
        [userId],
      );
      const payments = await pool.query(
        'SELECT reference, plan_code, kind, pack_code, tokens_granted, amount_kobo, currency, status, paid_at, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [userId],
      );
      const credits = await pool.query(
        'SELECT COALESCE(SUM(tokens), 0)::BIGINT AS tokens FROM usage_credits WHERE user_id = $1 AND expires_at > NOW()',
        [userId],
      );
      return {
        subscription: subscriptionResult.rows[0] ?? null,
        // The pack name travels with its code so the history reads without a
        // second request; a pack withdrawn from sale still shows its old name.
        payments: payments.rows.map((row) => ({ ...row, packName: findTopupPack(row.pack_code)?.name ?? null })),
        extraTokens: Number(credits.rows[0]?.tokens ?? 0),
      };
    },
    /**
     * The signed-in account's threads, most recently used first.
     *
     * The owner filter is in the query rather than a check made afterwards, so there is
     * no arrangement of arguments that reaches another account's rows. The list is
     * capped because a client renders a sidebar, not an export.
     * @param {string} userId
     * @returns {Promise<Array<object>>}
     */
    async listConversations(userId) {
      const result = await pool.query(
        CONVERSATION_COLUMNS + 'WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.updated_at DESC LIMIT $2',
        [userId, CONVERSATION_LIST_LIMIT],
      );
      return result.rows.map(publicConversation);
    },
    /**
     * Start a thread for an account.
     *
     * The count guard is part of the insert instead of a separate read-then-write, so
     * two requests arriving together cannot both pass a check that only one should. No
     * row comes back exactly when the account is at its limit, which is a normal
     * answer for the handler rather than a database fault.
     * @param {{ userId: string, title: string, model: string, origin: string }} details
     * @returns {Promise<object>}
     */
    async createConversation({ userId, title, model, origin }) {
      const result = await pool.query(
        'INSERT INTO conversations (user_id, title, model, origin) ' +
        'SELECT $1::uuid, $2::text, $3::text, $4::text ' +
        'WHERE (SELECT COUNT(*) FROM conversations WHERE user_id = $1::uuid) < $5::integer ' +
        'RETURNING id, title, model, origin, created_at, updated_at',
        [userId, title, model, origin, CONVERSATION_LIMIT],
      );
      const row = result.rows[0];
      if (!row) {
        const error = new Error('This account already holds as many conversations as it can store.');
        error.code = 'CONVERSATION_LIMIT';
        throw error;
      }
      return publicConversation({ ...row, message_count: 0 });
    },
    /**
     * One thread with its messages, oldest first.
     *
     * An id that is not a uuid is answered as missing before it reaches Postgres, which
     * would raise a syntax fault on the cast. A malformed id and another account's id
     * therefore look the same to the caller.
     * @param {string} userId
     * @param {string} conversationId
     * @returns {Promise<{ conversation: object, messages: Array<object> } | null>} null when the caller does not own the thread.
     */
    async getConversation(userId, conversationId) {
      if (!isUuid(conversationId)) return null;
      const found = await pool.query(
        CONVERSATION_COLUMNS + 'WHERE c.user_id = $1 AND c.id = $2 GROUP BY c.id',
        [userId, conversationId],
      );
      const row = found.rows[0];
      if (!row) return null;
      // The messages carry the owner in their own WHERE clause as well, so this read
      // cannot reach another account's thread even if it is reused somewhere else.
      // Two turns can share a timestamp, so the id breaks the tie and keeps the order
      // identical between two reads of the same thread.
      const messages = await pool.query(
        'SELECT m.id, m.role, m.content, m.created_at FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = $1 AND m.conversation_id = $2 ORDER BY m.created_at, m.id',
        [userId, conversationId],
      );
      return { conversation: publicConversation(row), messages: messages.rows.map(publicConversationMessage) };
    },
    /**
     * Append one turn to a thread.
     *
     * The append, the title rule and the bumped updated_at are one transaction, and the
     * conversation row is locked first: a second client writing at the same moment waits
     * instead of reading a message count that is about to change, which is what keeps
     * the cap honest and stops two first messages both naming the thread.
     * @param {{ userId: string, conversationId: string, role: string, content: string }} details
     * @returns {Promise<{ message: object, conversation: object } | null>} null when the caller does not own the thread.
     */
    async appendMessage({ userId, conversationId, role, content }) {
      if (!isUuid(conversationId)) return null;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const owned = await client.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE', [conversationId, userId]);
        if (owned.rowCount === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        const counted = await client.query(
          'SELECT COUNT(*)::INT AS message_count FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = $1 AND c.user_id = $2',
          [conversationId, userId],
        );
        if (Number(counted.rows[0]?.message_count ?? 0) >= MESSAGE_LIMIT) {
          const error = new Error('This conversation already holds as many messages as it can store.');
          error.code = 'MESSAGE_LIMIT';
          throw error;
        }
        const inserted = await client.query(
          'INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, created_at',
          [conversationId, role, content],
        );
        // A thread names itself after its first question, so the list reads like history
        // instead of a wall of "New chat". Only the untouched default is replaced: a
        // title the customer typed is theirs. TRIM keeps a leading newline out of the
        // sidebar.
        await client.query(
          "UPDATE conversations SET title = CASE WHEN title = 'New chat' AND $2 = 'user' THEN LEFT(TRIM($3), 60) ELSE title END, updated_at = NOW() WHERE id = $1 AND user_id = $4",
          [conversationId, role, content, userId],
        );
        const current = await client.query(
          CONVERSATION_COLUMNS + 'WHERE c.user_id = $1 AND c.id = $2 GROUP BY c.id',
          [userId, conversationId],
        );
        await client.query('COMMIT');
        return { message: publicConversationMessage(inserted.rows[0]), conversation: publicConversation(current.rows[0]) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    /**
     * Rename a thread.
     *
     * The rename moves it to the top of the history list, which is ordered by what
     * changed last: a thread somebody just named is the one they are looking at.
     * @param {string} userId
     * @param {string} conversationId
     * @param {string} title Already trimmed and capped by the caller.
     * @returns {Promise<object | null>} null when the caller does not own the thread.
     */
    async renameConversation(userId, conversationId, title) {
      if (!isUuid(conversationId)) return null;
      const result = await pool.query(
        'UPDATE conversations SET title = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
        [conversationId, userId, title],
      );
      if (result.rowCount === 0) return null;
      const current = await pool.query(
        CONVERSATION_COLUMNS + 'WHERE c.user_id = $1 AND c.id = $2 GROUP BY c.id',
        [userId, conversationId],
      );
      const row = current.rows[0];
      return row ? publicConversation(row) : null;
    },
    /**
     * Delete a thread. The schema's cascade takes its messages with it, so nothing is
     * left behind to be read by a later query.
     * @param {string} userId
     * @param {string} conversationId
     * @returns {Promise<boolean>} false when the caller does not own the thread.
     */
    async deleteConversation(userId, conversationId) {
      if (!isUuid(conversationId)) return false;
      const result = await pool.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id', [conversationId, userId]);
      return result.rowCount > 0;
    },
    async revokeSession(tokenHash) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);
    },
  };
}
