# Zuri Cloud server

This package is the Railway service for the planned Nigerian Zuri Cloud product.
It is intentionally separate from the Electron desktop package.

The first slice defines:

- `GET /api/health` for Railway health checks.
- `GET /api/plans` for the public NGN plan catalogue.
- `POST /api/auth/google` for Google ID-token sign-in and opaque bearer sessions.
- `POST /api/auth/sign-up` and `POST /api/auth/sign-in` for email and password accounts, and `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` for the emailed reset link.
- `GET /api/me` and `GET /api/me/usage` for protected account and quota data.
- `GET /api/me/limits` for the plan's request, concurrency, and prompt-size guardrails.
- `POST /api/chat` for an authenticated, quota-checked DeepSeek request.
- `POST /api/billing/checkout` to initialize a recurring Paystack checkout.
- `GET /api/billing/verify?reference=...` for server-side payment verification.
- `POST /api/paystack/webhook` for signed payment and subscription events.
- `GET /api/me/billing` for the current subscription and recent payments.
- `POST /api/auth/sign-out` to revoke a session.
- `db/schema.sql` for users, hashed sessions, subscriptions, usage events, and Paystack payments.

The schema is ready for PostgreSQL. Set `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, `ZAI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_STARTER`, `PAYSTACK_PLAN_PRO`, `PAYSTACK_PLAN_POWER`, and `NODE_ENV` in Railway. Password reset mail needs `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` and `SITE_URL` (the public dashboard the reset link points at); without the first two, `/api/auth/forgot-password` answers 503 `MAIL_NOT_CONFIGURED`. Google sign-in accepts a Google ID token, verifies its audience and verified email with Google's official client, and stores only a SHA-256 hash of each session token. Apply the schema with `psql "$DATABASE_URL" -f db/schema.sql` before enabling the database-backed server.

The account endpoints use `Authorization: Bearer <token>`. The sign-in response returns the token once, plus the current subscription and usage summary. Keep the token in the desktop client's protected storage and call sign-out when the user disconnects. A session lasts while it is used: every authenticated call moves `last_used_at` forward and pushes the expiry out by three days, and three quiet days end it. Passwords are hashed with scrypt, a reset token is stored only as a SHA-256 hash and works once within 60 minutes, and a reset revokes every session of that account.

The Starter plan is the entry plan. It includes 2,000,000 tokens per billing period,
30 requests per minute, two active requests at a time, 16,000 input tokens, and 2,000
output tokens per request. Zuri Flash is available from Starter; more expensive models
require higher plans.
Set `MOONSHOT_API_KEY`, `ZAI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` to enable the matching private suppliers. Customers choose Zuri model names, not supplier names. The model catalogue applies a quota weight to expensive models, so a request consumes `(input tokens + output tokens) * model weight` from the monthly allowance. The subscription itself is billed in NGN; users do not receive a separate charge per request.

The chat proxy reserves the full allowed request envelope in PostgreSQL before calling
DeepSeek, then records actual usage or releases the reservation on failure. The request
limiter is process-local for the initial single-service deployment. Move it to a shared
store before running multiple Railway replicas.

Paystack webhooks must be configured to call `/api/paystack/webhook`. The server checks
the `x-paystack-signature` HMAC before parsing or applying an event. Successful initial
checkouts and later recurring `charge.success` events update the local subscription;
failed or disabled subscription events move it to `past_due`, `cancelled`, or `expired`.

The server also serves the React web dashboard from `public/` (sign in with Google, usage, plans, Paystack checkout, payment history). The dashboard source lives in the repo's `web/` folder and is built into `public/` with `npm run web:build` at the repo root (Vite + React 19). The build output is committed because the Railway image only ships this folder. Apply the database schema with `npm run migrate` (needs `DATABASE_URL`, for example from a Railway PostgreSQL service; no local Postgres is required to run the tests).

## Deploying

The Railway service builds this folder with its `Dockerfile` (node:20-alpine). Two things catch people out:

- The service domain needs a target port. The server listens on `PORT` (default 8080), so set the domain's target port to the same number. Without it Railway answers 502 "Application failed to respond" while the app itself is healthy.
- Deploy this folder, not the repo root. The root is the Electron desktop app, whose start script cannot run in a container.

Run locally from this directory:

```text
npm test
npm start
```

To review the dashboard without a database or Google credentials, run `node scripts/preview-web.mjs` from the repo root: it serves `public/` with sample plans, usage and payments on http://127.0.0.1:8099.

Railway supplies `PORT`; `DATABASE_URL` enables PostgreSQL-backed accounts. Google sign-in stays switched off until `GOOGLE_CLIENT_ID` is set, and the sign-in card says so. Never put provider keys or Google client secrets in source control.
