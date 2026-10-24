import pg from 'pg';

const { Pool } = pg;

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
    createdAt: value.created_at,
  };
}

/** @param {string} connectionString @param {NodeJS.ProcessEnv} [environment] @returns {import('pg').Pool} */
export function createDatabase(connectionString, environment = process.env) {
  return new Pool({
    connectionString,
    ssl: environment.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

/** @param {import('pg').Pool} pool @returns {object} */
export function createRepository(pool) {
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
        await client.query(
          'INSERT INTO subscriptions (user_id, plan_code, status, current_period_start, current_period_end) ' +
          "SELECT $1, 'free', 'active', NOW(), NOW() + INTERVAL '1 month' " +
          "WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'past_due'))",
          [user.id],
        );
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
    async findSessionUser(tokenHash) {
      const result = await pool.query(
        'SELECT u.*, s2.id AS subscription_id, s2.plan_code, s2.current_period_start, s2.current_period_end, p.name AS plan_name, p.monthly_tokens ' +
        'FROM sessions s JOIN users u ON u.id = s.user_id ' +
        "JOIN subscriptions s2 ON s2.user_id = u.id AND s2.status IN ('active', 'past_due') " +
        'JOIN plans p ON p.code = s2.plan_code ' +
        "WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.status = 'active' LIMIT 1",
        [tokenHash],
      );
      const row = result.rows[0];
      if (!row) return null;
      await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);
      return {
        user: publicUser(row),
        subscription: {
          id: row.subscription_id,
          planCode: row.plan_code,
          planName: row.plan_name,
          monthlyTokens: Number(row.monthly_tokens),
          currentPeriodStart: row.current_period_start,
          currentPeriodEnd: row.current_period_end,
        },
      };
    },
    async getUsage(userId, periodStart, subscription) {
      const result = await pool.query(
        'SELECT COALESCE(SUM(total_tokens), 0)::BIGINT AS used_tokens FROM usage_events ' +
        'WHERE user_id = $1 AND created_at >= $2 AND created_at < $3',
        [userId, periodStart, subscription.currentPeriodEnd],
      );
      return { usedTokens: Number(result.rows[0]?.used_tokens ?? 0), subscription };
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
          "SELECT s.id, s.current_period_start, s.current_period_end, p.monthly_tokens FROM subscriptions s JOIN plans p ON p.code = s.plan_code WHERE s.id = $1 AND s.user_id = $2 AND s.status IN ('active', 'past_due') FOR UPDATE",
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
          "SELECT COALESCE((SELECT SUM(total_tokens) FROM usage_events WHERE user_id = $1 AND created_at >= $2 AND created_at < $3), 0) + COALESCE((SELECT SUM(reserved_tokens) FROM usage_reservations WHERE user_id = $1 AND subscription_id = $4 AND status = 'reserved' AND expires_at > NOW()), 0) AS committed_tokens",
          [userId, subscription.current_period_start, subscription.current_period_end, subscription.id],
        );
        const committedTokens = Number(usageResult.rows[0]?.committed_tokens ?? 0);
        if (!Number.isSafeInteger(committedTokens) || committedTokens + requested > Number(subscription.monthly_tokens)) {
          const error = new Error('This request would exceed the plan quota.');
          error.code = 'QUOTA_EXCEEDED';
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
    async commitUsage({ reservationId, userId, model, inputTokens, outputTokens, requestId }) {
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
        if (input + output > Number(reservation.reserved_tokens)) {
          const error = new Error('The provider usage exceeded the reserved budget.');
          error.code = 'RESERVATION_EXCEEDED';
          throw error;
        }
        await client.query(
          'INSERT INTO usage_events (user_id, subscription_id, model, input_tokens, output_tokens, request_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [userId, reservation.subscription_id, model, input, output, requestId],
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
    async releaseUsage(reservationId, userId) {
      await pool.query("UPDATE usage_reservations SET status = 'released' WHERE id = $1 AND user_id = $2 AND status = 'reserved'", [reservationId, userId]);
    },
    async createPayment({ userId, planCode, reference, amountKobo }) {
      const result = await pool.query(
        "INSERT INTO payments (user_id, plan_code, reference, amount_kobo, currency, status) VALUES ($1, $2, $3, $4, 'NGN', 'initialized') RETURNING id, reference, status",
        [userId, planCode, reference, amountKobo],
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
        await client.query(
          "UPDATE subscriptions SET plan_code = $2, status = 'active', current_period_start = NOW(), current_period_end = NOW() + INTERVAL '1 month', paystack_customer_code = COALESCE($3, paystack_customer_code), paystack_authorization_code = COALESCE($4, paystack_authorization_code), paystack_subscription_code = COALESCE($5, paystack_subscription_code), updated_at = NOW() WHERE user_id = $1 AND status IN ('active', 'past_due')",
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
        'SELECT s.id, s.plan_code, s.status, s.current_period_start, s.current_period_end, s.paystack_subscription_code, p.name AS plan_name, p.monthly_tokens FROM subscriptions s JOIN plans p ON p.code = s.plan_code WHERE s.user_id = $1 AND s.status IN (\'active\', \'past_due\', \'cancelled\') ORDER BY s.updated_at DESC LIMIT 1',
        [userId],
      );
      const payments = await pool.query(
        'SELECT reference, plan_code, amount_kobo, currency, status, paid_at, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [userId],
      );
      return { subscription: subscriptionResult.rows[0] ?? null, payments: payments.rows };
    },
    async revokeSession(tokenHash) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);
    },
  };
}
