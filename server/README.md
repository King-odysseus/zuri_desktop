# Zuri Cloud server

This package is the Railway service for the planned Nigerian Zuri Cloud product.
It is intentionally separate from the Electron desktop package.

The first slice defines:

- `GET /api/health` for Railway health checks.
- `GET /api/plans` for the public NGN plan catalogue.
- `POST /api/auth/google` for Google ID-token sign-in and opaque bearer sessions.
- `GET /api/me` and `GET /api/me/usage` for protected account and quota data.
- `POST /api/auth/sign-out` to revoke a session.
- `db/schema.sql` for users, hashed sessions, subscriptions, usage events, and Paystack payments.

The schema is ready for PostgreSQL. Set `DATABASE_URL`, `GOOGLE_CLIENT_ID`, and `NODE_ENV` in Railway. Google sign-in accepts a Google ID token, verifies its audience and verified email with Google's official client, and stores only a SHA-256 hash of each session token. Apply the schema with `psql "$DATABASE_URL" -f db/schema.sql` before enabling the database-backed server.

The account endpoints use `Authorization: Bearer <token>`. The sign-in response returns the token once, plus the current subscription and usage summary. Keep the token in the desktop client's protected storage and call sign-out when the user disconnects.

Run locally from this directory:

```text
npm test
npm start
```

Railway supplies `PORT`; `DATABASE_URL` enables PostgreSQL-backed accounts. Never put provider keys or Google client secrets in source control.
