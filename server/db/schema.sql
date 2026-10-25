-- Zuri Cloud uses NGN only for its first release. Paystack amounts are kobo.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  monthly_tokens BIGINT NOT NULL CHECK (monthly_tokens > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  google_subject TEXT UNIQUE,
  -- NULL means the account has no password yet: it signs in with Google only.
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Idle clock: a session dies once this is more than three days old.
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- Only the sha256 of a reset token is stored, so a leaked table row cannot be
-- turned back into a working link. used_at marks the single use.
CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_resets_user_created_idx
  ON password_resets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled', 'expired')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  paystack_customer_code TEXT,
  paystack_authorization_code TEXT,
  paystack_subscription_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_live_subscription_per_user
  ON subscriptions(user_id)
  WHERE status IN ('active', 'past_due');

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'deepseek',
  model TEXT NOT NULL,
  input_tokens BIGINT NOT NULL CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL CHECK (output_tokens >= 0),
  total_tokens BIGINT GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON usage_events(user_id, created_at DESC);

-- Reservations are held while the provider request is in flight. The
-- subscription row lock makes quota decisions atomic across concurrent calls.
CREATE TABLE IF NOT EXISTS usage_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  reserved_tokens BIGINT NOT NULL CHECK (reserved_tokens > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS usage_reservations_quota_idx
  ON usage_reservations(user_id, subscription_id, status, expires_at);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  reference TEXT NOT NULL UNIQUE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL CHECK (currency = 'NGN'),
  status TEXT NOT NULL CHECK (status IN ('initialized', 'success', 'failed', 'refunded')),
  paystack_transaction_id BIGINT,
  paystack_customer_code TEXT,
  paystack_authorization_code TEXT,
  paystack_subscription_code TEXT,
  raw_event JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT;
-- Databases created before password accounts existed get the new columns here.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_transaction_id BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT;

CREATE INDEX IF NOT EXISTS subscriptions_paystack_code_idx
  ON subscriptions(paystack_subscription_code);

-- The Zuri-branded models customers pick from. The supplier columns are private:
-- only the admin dashboard reads them. Rows are seeded once and then edited in the
-- dashboard, so the seed below never overwrites an admin change.
CREATE TABLE IF NOT EXISTS models (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  supplier TEXT NOT NULL,
  supplier_model TEXT NOT NULL,
  input_usd_per_million NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (input_usd_per_million >= 0),
  output_usd_per_million NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (output_usd_per_million >= 0),
  quota_weight NUMERIC(8, 2) NOT NULL DEFAULT 1 CHECK (quota_weight > 0),
  min_plan TEXT NOT NULL REFERENCES plans(code),
  rate_factor NUMERIC(4, 2) NOT NULL DEFAULT 1 CHECK (rate_factor > 0 AND rate_factor <= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- quota_tokens is what counts against the monthly allowance (raw tokens times the
-- model's weight); cost_micro_usd is what the supplier charged us for the request.
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS model_code TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS quota_tokens BIGINT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS cost_micro_usd BIGINT NOT NULL DEFAULT 0;
UPDATE usage_events SET quota_tokens = total_tokens WHERE quota_tokens IS NULL;

CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events(created_at DESC);

INSERT INTO plans (code, name, amount_kobo, monthly_tokens)
VALUES
  ('starter', 'Starter', 250000, 2000000),
  ('pro', 'Pro', 600000, 6000000),
  ('power', 'Power', 1500000, 12000000),
  ('max', 'Max', 4000000, 40000000)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    amount_kobo = EXCLUDED.amount_kobo,
    monthly_tokens = EXCLUDED.monthly_tokens,
    updated_at = NOW();

-- Accounts created before the paid-only catalogue keep their history but move
-- to Starter before the retired plan row is removed from the foreign-key graph.
UPDATE subscriptions SET plan_code = 'starter' WHERE plan_code = 'free';
UPDATE models SET min_plan = 'starter' WHERE min_plan = 'free';
DELETE FROM plans WHERE code = 'free';

INSERT INTO models (code, name, supplier, supplier_model, input_usd_per_million, output_usd_per_million, quota_weight, min_plan, rate_factor, sort_order)
VALUES
  ('zuri-flash', 'Zuri Flash', 'deepseek', 'deepseek-flash', 0.14, 0.28, 1, 'starter', 1, 1),
  ('zuri-pro', 'Zuri Pro', 'moonshot', 'kimi-k3', 0.6, 2.5, 5, 'starter', 0.5, 2),
  ('zuri-max', 'Zuri Max', 'zai', 'glm-5.3', 1.5, 6, 12, 'pro', 0.25, 3),
  ('zuri-code', 'Zuri Code', 'openai', 'gpt-5.3-codex', 1.75, 14, 10, 'pro', 0.4, 4),
  ('zuri-reason', 'Zuri Reason', 'anthropic', 'claude-sonnet-5-5', 2, 10, 10, 'pro', 0.4, 5),
  ('zuri-elite', 'Zuri Elite', 'anthropic', 'claude-opus-5-5', 4, 20, 20, 'max', 0.2, 6)
ON CONFLICT (code) DO NOTHING;
