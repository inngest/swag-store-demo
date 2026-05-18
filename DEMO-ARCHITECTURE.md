# Demo Architecture Notes

## Product Goal

`swag-store-demo` is a controlled commerce demo for Inngest. It should feel like a real production store, while giving presenters deliberate control over success, failure, retry, repair, and reset paths.

## Core Demo Story

1. A presenter places a test order.
2. The customer page shows live workflow progress.
3. The presenter opens Inngest and inspects the function run.
4. The presenter creates a broken order.
5. Inngest shows completed steps, failed step, retry attempts, and error context.
6. The presenter repairs or resets the demo and repeats the story.

## Backend Shape

Use Railway Postgres for demo data because it is resettable and production-like enough for a sales/devrel story.

Suggested tables:

- `products`
- `product_variants`
- `inventory`
- `orders`
- `order_items`
- `fulfillment_events`
- `demo_sessions`
- `demo_system_state`
- `demo_scenarios`

## Demo Reset

`POST /api/demo/reset` should reset app-owned demo state:

- Re-seed products and variants.
- Restore inventory quantities.
- Clear active scenario overrides.
- Mark simulated dependencies healthy.
- Create a fresh `demoSessionId`.
- Optionally seed a few completed orders for the admin screen.

Do not try to delete Inngest history. Instead, include `demoSessionId`, `orderId`, and scenario fields on every event so presenters can filter the current story.

## Failure Controls

Failure should be deterministic and readable in the Inngest dashboard.

Recommended first scenarios:

- `happy-path`: every step succeeds.
- `flaky-inventory`: inventory reservation fails once or twice, then succeeds.
- `broken-fulfillment`: fulfillment recording fails until the presenter repairs it.

Use clear error messages:

```txt
DEMO_FAILURE: Warehouse API returned 503 while reserving inventory
DEMO_FAILURE: Supplier fulfillment endpoint is currently down
```

## Supplier Boundary

The real store may eventually talk to a supplier. Keep the Inngest workflow insulated from backend details with a small domain interface:

```ts
type FulfillmentBackend = {
  reserveInventory(input: ReserveInventoryInput): Promise<InventoryReservation>;
  releaseInventory(input: ReleaseInventoryInput): Promise<void>;
  recordFulfillment(input: RecordFulfillmentInput): Promise<FulfillmentRecord>;
  getOrder(input: GetOrderInput): Promise<OrderDetail | null>;
};
```

Implementations:

- `railwayFulfillmentBackend`: demo data and resettable failures.
- `supplierFulfillmentBackend`: future production supplier API.
- `testFulfillmentBackend`: local tests and fixtures.

The Inngest function should call the interface, not a specific database or supplier client.
