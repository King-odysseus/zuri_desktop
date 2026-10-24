import pg from 'pg';

const { Pool } = pg;

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
        'SELECT u.*, s2.plan_code, s2.current_period_start, s2.current_period_end, p.name AS plan_name, p.monthly_tokens ' +
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
    async revokeSession(tokenHash) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1', [tokenHash]);
    },
  };
}
