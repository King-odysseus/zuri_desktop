# Zuri Cloud server

This package is the Railway service for the planned Nigerian Zuri Cloud product.
It is intentionally separate from the Electron desktop package.

The first slice defines:

- `GET /api/health` for Railway health checks.
- `GET /api/plans` for the public NGN plan catalogue.
- `db/schema.sql` for users, hashed sessions, subscriptions, usage events, and Paystack payments.

The schema is ready for PostgreSQL. Authentication, the DeepSeek proxy, usage enforcement, Paystack webhooks, and the admin dashboard are separate follow-up slices so they can be tested without mixing payment or identity logic into the health service.

Run locally from this directory:

```text
npm test
npm start
```

Railway should run `npm start` with `PORT` supplied by the platform. `DATABASE_URL` is defined in the environment contract now and will be used when the database repository is added.
