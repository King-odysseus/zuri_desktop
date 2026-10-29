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
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired')),
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
  reserved_credit_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credit_tokens >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

ALTER TABLE usage_reservations ADD COLUMN IF NOT EXISTS reserved_credit_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credit_tokens >= 0);

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
DO $$
BEGIN
  ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
  ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Databases created before password accounts existed get the new columns here.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_transaction_id BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_authorization_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT;

CREATE INDEX IF NOT EXISTS subscriptions_paystack_code_idx
  ON subscriptions(paystack_subscription_code);

-- Saved chat history, shared by the web, desktop and Android clients. It is per
-- account rather than per device, so signing in somewhere else shows the same
-- threads. ON DELETE CASCADE is what makes deleting an account take its history
-- with it: no conversation can outlive the customer who wrote it.
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  -- The model the thread was started on, kept for display only: a thread is not
  -- pinned to it, so a retired model never blocks reading old messages.
  model TEXT NOT NULL DEFAULT 'zuri-flash',
  -- Which client started the thread, so the list can badge it without a join.
  origin TEXT NOT NULL DEFAULT 'web' CHECK (origin IN ('web', 'desktop', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read of this table is "this account's threads, newest first", so the index
-- leads with the owner and then walks updated_at backwards.
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations(user_id, updated_at DESC);

-- One row per turn. Deleting a thread (or the account behind it) must not leave
-- messages behind, so they cascade with their conversation.
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A thread is always read in write order for one conversation at a time, so the
-- index pairs the two: the conversation first, then the time inside it.
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
  ON conversation_messages(conversation_id, created_at);

-- The Zuri-branded models customers pick from. The supplier columns are private:
-- only the admin dashboard reads them. Rows are seeded once and then edited in the
-- dashboard, so the seed below never overwrites an admin change.
CREATE TABLE IF NOT EXISTS models (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  supplier TEXT NOT NULL,
  supplier_model TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  usd_per_image NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (usd_per_image >= 0),
  quota_tokens_per_image INTEGER NOT NULL DEFAULT 0 CHECK (quota_tokens_per_image >= 0),
  image_quality TEXT NOT NULL DEFAULT '',
  input_usd_per_million NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (input_usd_per_million >= 0),
  output_usd_per_million NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (output_usd_per_million >= 0),
  quota_weight NUMERIC(8, 2) NOT NULL DEFAULT 1 CHECK (quota_weight > 0),
  output_quota_weight NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (output_quota_weight >= 0),
  min_plan TEXT NOT NULL REFERENCES plans(code),
  rate_factor NUMERIC(4, 2) NOT NULL DEFAULT 1 CHECK (rate_factor > 0 AND rate_factor <= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Databases created before image models existed get the picture columns here. The
-- defaults leave every existing row a text model, so nothing starts being billed
-- per image after the upgrade.
ALTER TABLE models ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE models ADD COLUMN IF NOT EXISTS usd_per_image NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (usd_per_image >= 0);
ALTER TABLE models ADD COLUMN IF NOT EXISTS quota_tokens_per_image INTEGER NOT NULL DEFAULT 0 CHECK (quota_tokens_per_image >= 0);
ALTER TABLE models ADD COLUMN IF NOT EXISTS image_quality TEXT NOT NULL DEFAULT '';

-- Replies are dearer than prompts at every supplier on this catalogue, so they
-- carry their own weight. 0 means "charge replies at quota_weight", which is how
-- every row behaved before the split, so this default changes nobody's bill.
ALTER TABLE models ADD COLUMN IF NOT EXISTS output_quota_weight NUMERIC(8, 2) NOT NULL DEFAULT 0 CHECK (output_quota_weight >= 0);

-- quota_tokens is what counts against the monthly allowance (raw tokens times the
-- model's weight); cost_micro_usd is what the supplier charged us for the request.
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS model_code TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS quota_tokens BIGINT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS cost_micro_usd BIGINT NOT NULL DEFAULT 0;
UPDATE usage_events SET quota_tokens = total_tokens WHERE quota_tokens IS NULL;

CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events(created_at DESC);

INSERT INTO plans (code, name, amount_kobo, monthly_tokens)
VALUES
  ('starter', 'Starter', 249900, 2000000),
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

INSERT INTO models (code, name, supplier, supplier_model, input_usd_per_million, output_usd_per_million, quota_weight, output_quota_weight, min_plan, rate_factor, sort_order)
VALUES
  ('zuri-flash', 'Zuri Flash', 'deepseek', 'deepseek-flash', 0.14, 0.28, 1, 1, 'starter', 1, 1),
  ('zuri-pro', 'Zuri Pro', 'moonshot', 'kimi-k3', 0.6, 2.5, 5, 8, 'starter', 0.5, 2),
  ('zuri-max', 'Zuri Max', 'zai', 'glm-5.3', 1.5, 6, 12, 18, 'pro', 0.25, 3),
  ('zuri-code', 'Zuri Core', 'openai', 'gpt-6.1-sol', 2, 10, 10, 30, 'pro', 0.4, 4),
  ('zuri-reason', 'Zuri Reason', 'anthropic', 'claude-sonnet-5-5', 2, 10, 10, 30, 'pro', 0.4, 5),
  ('zuri-elite', 'Zuri Elite', 'anthropic', 'claude-opus-5-5', 4, 20, 20, 60, 'max', 0.2, 6)
ON CONFLICT (code) DO NOTHING;

-- A database seeded before the split holds output_quota_weight at 0, and the seed
-- above never overwrites an existing row. Fill the new weights in, but only where
-- the row still matches what was seeded: if an operator has already changed the
-- supplier price, their figure stays and theirs is the one to revisit.
UPDATE models SET output_quota_weight = 1  WHERE code = 'zuri-flash'  AND output_quota_weight = 0 AND output_usd_per_million = 0.28;
UPDATE models SET output_quota_weight = 8  WHERE code = 'zuri-pro'    AND output_quota_weight = 0 AND output_usd_per_million = 2.5;
UPDATE models SET output_quota_weight = 18 WHERE code = 'zuri-max'    AND output_quota_weight = 0 AND output_usd_per_million = 6;

-- OpenAI marks gpt-5.3-codex Deprecated, so this row moves to the current GPT-6.1 Sol
-- at $2/$10 per million tokens, with its reply weight at three times the output price
-- like the rest of the catalogue. Keyed on the old id so an admin choice is never
-- overwritten.
UPDATE models SET supplier_model = 'gpt-6.1-sol', input_usd_per_million = 2, output_usd_per_million = 10, output_quota_weight = 30
  WHERE code = 'zuri-code' AND supplier_model = 'gpt-5.3-codex';
UPDATE models SET output_quota_weight = 30 WHERE code = 'zuri-reason' AND output_quota_weight = 0 AND output_usd_per_million = 10;
UPDATE models SET output_quota_weight = 60 WHERE code = 'zuri-elite'  AND output_quota_weight = 0 AND output_usd_per_million = 20;

-- The row no longer sells coding: it is an OpenAI general model priced the same as
-- Zuri Reason, so it is sold as Zuri Core. Only the seeded name is moved, so a name
-- an operator chose in the dashboard is never overwritten.
UPDATE models SET name = 'Zuri Core' WHERE code = 'zuri-code' AND name = 'Zuri Code';

-- Image models are billed per picture through quota_tokens_per_image instead of
-- input/output prices, so the one monthly allowance still covers them.
INSERT INTO models (code, name, supplier, supplier_model, kind, usd_per_image, quota_tokens_per_image, image_quality, input_usd_per_million, output_usd_per_million, quota_weight, output_quota_weight, min_plan, rate_factor, sort_order)
VALUES
  ('zuri-sketch', 'Zuri Sketch', 'zai', 'cogview-4', 'image', 0.012, 48000, 'standard', 0, 0, 1, 0, 'starter', 0.4, 7),
  ('zuri-canvas', 'Zuri Canvas', 'openai', 'gpt-image-2', 'image', 0.07, 264000, 'medium', 0, 0, 1, 0, 'pro', 0.3, 8),
  ('zuri-studio', 'Zuri Studio', 'openai', 'gpt-image-2', 'image', 0.19, 720000, 'high', 0, 0, 1, 0, 'max', 0.2, 9)
ON CONFLICT (code) DO NOTHING;

-- Extra usage is bought as a one-off pack, not as a bigger subscription, so a
-- payment row can now exist without a plan. kind keeps the two flows apart
-- while both keep sharing one payment history.
ALTER TABLE payments ALTER COLUMN plan_code DROP NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'subscription';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pack_code TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tokens_granted BIGINT;

-- Purchased tokens are a ceiling, not a wallet: the allowance for a period is
-- the plan's tokens plus every pack that has not expired, and usage_events
-- keeps doing the counting. Nothing has to be decremented per request, which
-- is what makes a refund or an expiry safe to interrupt at any moment.
CREATE TABLE IF NOT EXISTS usage_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  pack_code TEXT NOT NULL,
  tokens BIGINT NOT NULL CHECK (tokens > 0),
  used_tokens BIGINT NOT NULL DEFAULT 0 CHECK (used_tokens >= 0 AND used_tokens <= tokens),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE usage_credits ADD COLUMN IF NOT EXISTS used_tokens BIGINT NOT NULL DEFAULT 0;
DO $$
BEGIN
  ALTER TABLE usage_credits ADD CONSTRAINT usage_credits_used_tokens_check CHECK (used_tokens >= 0 AND used_tokens <= tokens);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS usage_credits_user_expiry_idx ON usage_credits (user_id, expires_at);

-- A message may carry one uploaded file. The bytes live on Cloudinary, never in
-- this database: the column holds only the delivery details, so a thread row
-- stays small and a download never passes through the API.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS attachment JSONB;

-- A chat can be held at the top of the list, or filed away out of it. Both are
-- flags on the row rather than a second table, because they describe the
-- conversation itself and a thread has exactly one such state.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- A project is one piece of work that several chats belong to. The instructions
-- live on the project rather than on each chat, so a rule written once is read
-- by every thread that is filed under it, and a customer who starts a new chat
-- does not restate the same background. It is owned by one account and cascade
-- deletes with it: a project cannot outlive the customer who made it.
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The project list is always "this account's projects, most recently used
-- first", so the index leads with the owner and then walks updated_at backwards.
CREATE INDEX IF NOT EXISTS projects_user_updated_idx
  ON projects(user_id, updated_at DESC);

-- Reference files a project hands to the model with every question in it. The
-- small ones keep their text in this column so a prompt can include it directly;
-- a picture or a PDF has no text to extract, so it carries its link instead and
-- its content stays empty. bytes is what the file weighed, so a list can show a
-- size without reading the text it is deliberately not sending.
CREATE TABLE IF NOT EXISTS project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  bytes BIGINT NOT NULL DEFAULT 0,
  url TEXT,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A project's files are read together, in the order they were added, so the
-- index pairs the project with the time inside it.
CREATE INDEX IF NOT EXISTS project_files_project_created_idx
  ON project_files(project_id, created_at);

-- A chat belongs to a project, or to none. SET NULL rather than CASCADE is the
-- whole point: deleting a project files its chats back into the plain history
-- instead of destroying work the customer wrote. An old thread keeps every
-- message it had, it simply stops having a project.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Opening a project lists its chats newest first, and that read filters on the
-- project before it sorts, so the index carries both columns.
CREATE INDEX IF NOT EXISTS conversations_project_idx
  ON conversations(project_id, updated_at DESC);

-- Tasks and reminders mirror the desktop app's own Tasks and Reminders pages, so
-- one account keeps the same to-do list whether the person is typing in the
-- browser, on a phone or in the app on the desk. They live here because the list
-- belongs to the account rather than to the machine: a to-do written in the app
-- has to be waiting when the phone opens, and a reminder has to still be due after
-- a reinstall.
--
-- Neither is metered or held behind a plan. A line of text costs nothing to store,
-- and charging for a to-do would only push people back to a notes file.

-- due is TEXT, not a date or a timestamp, because it holds what the person typed:
-- a plain calendar date such as 2026-11-02, or an empty string for "no date yet".
-- A date column would pin a timezone to it, so somebody in Lagos who typed
-- 2026-11-02 would be shown 2026-11-01 once the server read it back as UTC. Keeping
-- the text means nothing is converted and nobody's deadline moves by a day.
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list screen asks one question: this account's open work, newest first, with
-- the finished items behind it. done sits in the middle so counting what is still
-- open never walks the rows that are already dealt with.
CREATE INDEX IF NOT EXISTS tasks_user_done_created_idx
  ON tasks(user_id, done, created_at DESC);

-- due_at is TIMESTAMPTZ, unlike a task's due above, because the two mean different
-- things. A reminder has to go off at one exact moment, so it is a real instant and
-- the timezone is part of the answer. repeat records how it comes back: once never
-- does, interval returns every interval_minutes, daily returns at time_of_day, a
-- HH:MM string in the account's own local time. interval_minutes and time_of_day
-- stay null when that repeat does not use them, so a row never stores a rule that
-- contradicts its own repeat value.
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'once',
  interval_minutes INTEGER,
  time_of_day TEXT,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "What falls due next for this account" is the only read the reminder screen
-- makes, so the index is the owner, whether it has been dealt with, and the moment
-- it falls due.
CREATE INDEX IF NOT EXISTS reminders_user_done_due_idx
  ON reminders(user_id, done, due_at);

-- A picture uploaded in the browser chat used to go straight to an outside image host.
-- On a deployment where that host is not configured the upload failed, so the picture
-- never appeared and Zuri never saw it. This table is the fallback that keeps a small
-- picture with the account that sent it, so attaching a photo works even when nothing
-- outside this service is set up.
--
-- The bytes live in the row rather than on disk because this service runs where the
-- filesystem is thrown away on the next deploy, and a picture that disappears would
-- take the meaning of the conversation with it. data is BYTEA so a PNG is stored
-- exactly as it arrived; bytes repeats its length because every list read needs the
-- size and reading a whole image column just to measure it would be wasteful.
--
-- Reading is always scoped to the owner: this is somebody's picture, so the query that
-- returns data matches on user_id as well as id, and one account can never fetch
-- another account's file.
CREATE TABLE IF NOT EXISTS stored_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newest first for one account is the only order this table is ever read in.
CREATE INDEX IF NOT EXISTS stored_files_user_created_idx
  ON stored_files(user_id, created_at DESC);

-- A saved prompt the server runs by itself on a schedule.
--
-- Why this lives on the server rather than in the desktop app's own files: the
-- desktop scheduler only fires while that computer is awake with Zuri open, so a
-- 07:00 job check never happened on a laptop that was shut. A row here is run by
-- the service itself, which is what makes "tell me what you found each morning"
-- true on a phone as well.
--
-- The cadence is three columns rather than one JSON blob because the scheduler
-- selects on next_run_at in SQL and reads the rule only once a row is due, and
-- because a malformed blob would be a row that can never be scheduled. Exactly one
-- of interval_minutes and time_of_day carries the rule, decided by cadence_type;
-- 'once' needs neither, since next_run_at alone says when.
CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  cadence_type TEXT NOT NULL DEFAULT 'daily',
  interval_minutes INTEGER,
  time_of_day TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deliver_email BOOLEAN NOT NULL DEFAULT FALSE,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The scheduler's own query: every enabled row anywhere in the service whose turn
-- has come. It is not scoped to one account, so user_id is deliberately absent and
-- the index is only what that sweep reads.
CREATE INDEX IF NOT EXISTS automations_due_idx
  ON automations(enabled, next_run_at);

-- The Automations screen reads one account's rows, newest first.
CREATE INDEX IF NOT EXISTS automations_user_created_idx
  ON automations(user_id, created_at DESC);

-- What one run of an automation produced.
--
-- Kept as rows rather than only emailed because the person may read the result on a
-- phone days later, and because a failed run has to be able to say why rather than
-- vanish. user_id is repeated from the parent so a read can be scoped to the owner
-- without a join, which is the guard every other table here uses.
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ok',
  text TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  searches INTEGER NOT NULL DEFAULT 0
);

-- One automation's history, newest first, which is how the screen opens it.
CREATE INDEX IF NOT EXISTS automation_runs_automation_started_idx
  ON automation_runs(automation_id, started_at DESC);
