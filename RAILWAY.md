# Railway Deployment

This demo can live in Sterling's Railway account for now. Nothing in the app is tied to that account, so the project can later move to an Inngest-owned Railway workspace or keep Railway as only the Postgres provider.

## Recommended Setup

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Add a PostgreSQL database to the same Railway project.
4. In the app service, add a reference variable named `DATABASE_URL` from the Postgres service.
5. Add the remaining app variables listed below.
6. Deploy, then visit `/demo` and run **Reset everything**.

Railway reads `railway.json` from this repo. The app uses standalone Next output and starts with:

```bash
npm run start
```

Railway healthchecks hit:

```txt
/api/health
```

## Required Variables

```txt
DATABASE_URL=
NEXT_PUBLIC_APP_URL=
DEMO_RESET_SECRET=

STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
INNGEST_ENCRYPTION_KEY=
```

For local dev, keep `INNGEST_DEV=1`. Do not set `INNGEST_DEV` in Railway.

## Stripe

Use Stripe test mode for this demo. Point the webhook endpoint at:

```txt
https://<railway-domain>/api/webhooks/stripe
```

After a custom domain lands, update it to:

```txt
https://swag.demo.inngest.com/api/webhooks/stripe
```

## Inngest

Create or use a separate Inngest app/environment for the demo. The key distinction is not Railway ownership; it is keeping demo events, runs, and failures separate from the real swag store.

Suggested app name:

```txt
swag-store-demo
```

## Moving Later

If this starts in Sterling's Railway account, a later move should only require:

- Creating a new Railway project/workspace.
- Re-adding Postgres.
- Copying environment variables.
- Updating DNS and webhook URLs.
- Running `/api/demo/reset` once to seed fresh state.
