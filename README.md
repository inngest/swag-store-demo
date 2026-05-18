# Inngest Swag Store Demo

Production-like demo store for showing how Inngest runs, retries, fails, and recovers durable commerce workflows.

Target demo domain: `swag.demo.inngest.com`.

## What This Is

This repo starts from the real Inngest swag store, then diverges into a controlled demo environment for sales, developer relations, talks, and meetups.

The demo store should let a presenter:

- Place a realistic test purchase.
- Watch the customer-facing workflow progress in real time.
- Open the Inngest dashboard and inspect the function run.
- Trigger intentional failures in downstream systems.
- Repair/reset the demo environment and run the story again.

## Demo Architecture

```txt
Stripe test checkout -> POST /api/webhooks/stripe -> inngest.send("store/order.placed")
                                                               |
                                                               v
                                             fulfill-order Inngest function
                                               - capture payment
                                               - reserve inventory
                                               - send confirmation
                                               - record fulfillment
                                                               |
                                                               v
                                      Railway Postgres demo data store

Realtime publishes:
  - order:{orderId} -> customer order status page
  - admin           -> presenter/admin live tracker
```

The current code still contains the original Google Sheets-backed fulfillment path. The demo migration should replace that with Railway Postgres as the demo system of record.

## Demo Backend Direction

Railway should own resettable demo state:

- Products and variants
- Inventory counts
- Orders and order items
- Fulfillment status
- Demo scenario state
- Simulated dependency health

The reset endpoint should restore all demo state in one shot:

```txt
POST /api/demo/reset
```

Expected reset behavior:

- Delete or archive demo orders.
- Re-seed inventory.
- Clear active failure toggles.
- Reset fake supplier/email/fulfillment services to healthy.
- Create a new demo session identifier for filtering fresh runs.

Inngest run history should remain in Inngest. The app should instead tag every demo order/event with a `demoSessionId` so presenters can clearly separate the current run from older ones.

## Supplier-Ready Boundary

The demo will use Railway because it is fast, resettable, and predictable. The real swag store may eventually integrate with a supplier instead.

Keep that future path clean by treating inventory and fulfillment as ports:

- Demo implementation: Railway Postgres
- Real implementation: supplier API
- Test implementation: in-memory or fixture-backed adapter

The Inngest workflow should call domain-level operations like `reserveInventory`, `recordFulfillment`, and `releaseInventory`, not know whether the backend is Postgres, Google Sheets, or a supplier.

## Local Setup

You need:

- Node 20+
- Stripe test-mode account
- Stripe CLI installed (`brew install stripe/stripe-cli/stripe`)
- Inngest dev server
- Railway Postgres for the demo backend once the migration lands

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

In separate terminals:

```bash
npx inngest-cli@latest dev
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Visit:

- Store: [http://localhost:3000](http://localhost:3000)
- Demo/admin tracker: [http://localhost:3000/admin](http://localhost:3000/admin)
- Local Inngest dashboard: [http://localhost:8288](http://localhost:8288)

## Migration Plan

1. Add a Railway/Postgres schema for products, variants, inventory, orders, order items, demo scenarios, and demo system state.
2. Introduce repository/adapter functions for inventory and fulfillment.
3. Move reads and writes from Google Sheets to Postgres behind those adapters.
4. Add `POST /api/demo/reset`.
5. Add a protected presenter console for happy path, flaky, and broken scenarios.
6. Add dashboard deep links or searchable identifiers for each order/run.

## Current Project Layout

| Path | Purpose |
|------|---------|
| `src/app/api/checkout/route.ts` | Creates Stripe Checkout Sessions |
| `src/app/api/webhooks/stripe/route.ts` | Validates Stripe signatures, fires `store/order.placed` |
| `src/app/api/inngest/route.ts` | Inngest serve handler |
| `src/inngest/client.ts` | Inngest client + encryption middleware |
| `src/inngest/channels.ts` | Realtime channels (`order:{id}`, `admin`) |
| `src/inngest/functions/fulfill-order.ts` | Durable fulfillment workflow |
| `src/lib/sheets.ts` | Legacy Google Sheets fulfillment store, pending replacement |
| `src/lib/catalog.ts` | Static product catalog |
| `src/components/OrderStatusClient.tsx` | Customer-facing order page |
| `src/components/AdminClient.tsx` | Public live order tracker |

## Privacy Model

- Order page (`/orders/[id]`) defaults to masked PII.
- Customer arriving from Stripe redirect can unlock full order details for that order.
- Step outputs and realtime payloads should stay PII-free.
- PII in Inngest event payloads should remain under `event.data.encrypted`.

## License

MIT. This is a demo-focused fork of the Inngest swag store.
