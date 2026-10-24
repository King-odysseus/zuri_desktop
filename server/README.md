# Zuri Cloud server

This package is the Railway service for the planned Nigerian Zuri Cloud product.
It is intentionally separate from the Electron desktop package.

The first slice defines:

- `GET /api/health` for Railway health checks.
- `GET /api/plans` for the public NGN plan catalogue.
- `POST /api/auth/google` for Google ID-token sign-in and opaque bearer sessions.
- `GET /api/me` and `GET /api/me/usage` for protected account and quota data.
- `GET /api/me/limits` for the plan's request, concurrency, and prompt-size guardrails.
- `POST /api/chat` for an authenticated, quota-checked DeepSeek request.
- `POST /api/auth/sign-out` to revoke a session.
- `db/schema.sql` for users, hashed sessions, subscriptions, usage events, and Paystack payments.

The schema is ready for PostgreSQL. Set `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `DEEPSEEK_API_KEY`, and `NODE_ENV` in Railway. Google sign-in accepts a Google ID token, verifies its audience and verified email with Google's official client, and stores only a SHA-256 hash of each session token. Apply the schema with `psql "$DATABASE_URL" -f db/schema.sql` before enabling the database-backed server.

The account endpoints use `Authorization: Bearer <token>`. The sign-in response returns the token once, plus the current subscription and usage summary. Keep the token in the desktop client's protected storage and call sign-out when the user disconnects.

The free plan is limited to 100,000 tokens per billing period, 10 requests per minute,
one active request at a time, 8,000 input tokens, and 1,000 output tokens per request.
The chat proxy reserves the full allowed request envelope in PostgreSQL before calling
DeepSeek, then records actual usage or releases the reservation on failure. The request
limiter is process-local for the initial single-service deployment. Move it to a shared
store before running multiple Railway replicas.

Run locally from this directory:

```text
npm test
npm start
```

Railway supplies `PORT`; `DATABASE_URL` enables PostgreSQL-backed accounts. Never put provider keys or Google client secrets in source control.
