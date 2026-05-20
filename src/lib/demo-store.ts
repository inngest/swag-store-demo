import type { PoolClient } from 'pg';
import { PRODUCTS } from './catalog';
import { getPool, hasDatabaseUrl } from './db';
import type { OrderDetail, OrderRow } from './sheets';
import {
  appendOrder as appendSheetOrder,
  fetchOrder as fetchSheetOrder,
  fetchPublicOrders as fetchSheetPublicOrders,
} from './sheets';

export type DemoScenario =
  | 'happy-path'
  | 'flaky-inventory'
  | 'broken-fulfillment'
  | 'regional-outage';

export type DemoTrendPoint = {
  label: string;
  startDate: string;
  endDate: string;
  orders: number;
  revenueCents: number;
};

export type DemoProductTrend = {
  name: string;
  quantity: number;
  revenueCents: number;
};

export type DemoAnalytics = {
  totalOrders: number;
  totalRevenueCents: number;
  last30DaysOrders: number;
  last30DaysRevenueCents: number;
  months: DemoTrendPoint[];
  topProducts: DemoProductTrend[];
};

export type DemoLineItem = {
  description: string | null;
  quantity: number | null;
  amountTotal: number | null;
  productId?: string;
  productName?: string;
  sku?: string;
  variantId?: string;
  size?: string;
  color?: string;
};

export type InventoryReservation = {
  sku: string;
  name: string;
  size: string;
  color: string;
  quantity: number;
  reservedAt: string;
};

export function isDemoStoreEnabled(): boolean {
  return hasDatabaseUrl();
}

export async function ensureDemoSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    create table if not exists demo_sessions (
      id text primary key,
      created_at timestamptz not null default now(),
      label text not null default ''
    );

    create table if not exists demo_system_state (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists demo_products (
      id text primary key,
      slug text not null,
      name text not null,
      sku text not null,
      price_cents integer not null,
      category text not null,
      image text not null
    );

    create table if not exists demo_variants (
      id text primary key,
      product_id text not null references demo_products(id) on delete cascade,
      sku text not null,
      size text not null default '',
      color text not null default '',
      initial_stock integer not null,
      stock integer not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists demo_orders (
      order_id text primary key,
      demo_session_id text,
      created_at timestamptz not null,
      customer_email text not null default '',
      customer_name text not null default '',
      customer_phone text not null default '',
      items text not null default '',
      total_cents integer not null default 0,
      currency text not null default 'USD',
      ship_address text not null default '',
      ship_city text not null default '',
      ship_state text not null default '',
      ship_zip text not null default '',
      ship_country text not null default '',
      status text not null default 'pending',
      tracking text not null default '',
      notes text not null default '',
      scenario text not null default 'happy-path',
      stripe_session_id text
    );

    create table if not exists demo_order_items (
      id bigserial primary key,
      order_id text not null references demo_orders(order_id) on delete cascade,
      product_id text,
      variant_id text,
      sku text not null default '',
      name text not null,
      size text not null default '',
      color text not null default '',
      quantity integer not null,
      amount_total integer
    );

    create table if not exists demo_step_attempts (
      order_id text not null,
      step_name text not null,
      attempts integer not null default 0,
      primary key (order_id, step_name)
    );
  `);
}

export async function resetDemoStore({
  scenario = 'happy-path',
  seedOrders = false,
}: {
  scenario?: DemoScenario;
  seedOrders?: boolean;
} = {}): Promise<{ demoSessionId: string; scenario: DemoScenario }> {
  await ensureDemoSchema();
  const demoSessionId = `demo_${Date.now().toString(36)}`;

  await getPool().query(
    'truncate table demo_order_items, demo_orders, demo_step_attempts restart identity',
  );

  await seedCatalog();

  await getPool().query(
    `insert into demo_sessions (id, label)
     values ($1, $2)
     on conflict (id) do nothing`,
    [demoSessionId, 'Active demo session'],
  );

  await setStateValue('active_session_id', demoSessionId);
  await setStateValue('active_scenario', scenario);

  if (seedOrders) {
    await seedCompletedOrders(demoSessionId);
  }

  return { demoSessionId, scenario };
}

export async function setDemoScenario(
  scenario: DemoScenario,
): Promise<{ demoSessionId: string; scenario: DemoScenario }> {
  await ensureDemoSchema();
  await setStateValue('active_scenario', scenario);
  const demoSessionId = await getActiveDemoSessionId();
  return { demoSessionId, scenario };
}

export async function getDemoState(): Promise<{
  demoSessionId: string;
  scenario: DemoScenario;
}> {
  await ensureDemoSchema();
  const [demoSessionId, scenario] = await Promise.all([
    getActiveDemoSessionId(),
    getActiveScenario(),
  ]);
  return { demoSessionId, scenario };
}

export async function reserveInventory({
  orderId,
  lineItems,
}: {
  orderId: string;
  lineItems: DemoLineItem[];
}): Promise<{ reservations: InventoryReservation[]; count: number }> {
  await ensureDemoSchema();
  await maybeFailDemoStep(orderId, 'reserve-inventory');

  const pool = getPool();
  const reservedAt = new Date().toISOString();
  const reservations: InventoryReservation[] = [];

  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const item of lineItems ?? []) {
      const quantity = item.quantity ?? 1;
      const variant = await findVariantForUpdate(client, item);

      if (!variant) {
        throw new Error(
          `DEMO_FAILURE: No inventory variant found for ${item.productName ?? item.description ?? 'item'}`,
        );
      }

      if (variant.stock < quantity) {
        throw new Error(
          `DEMO_FAILURE: Insufficient inventory for ${variant.sku}; requested ${quantity}, available ${variant.stock}`,
        );
      }

      await client.query(
        `update demo_variants
         set stock = stock - $1, updated_at = now()
         where id = $2`,
        [quantity, variant.id],
      );

      reservations.push({
        sku: variant.sku,
        name: item.productName ?? item.description ?? variant.name,
        size: item.size ?? variant.size ?? '',
        color: item.color ?? variant.color ?? '',
        quantity,
        reservedAt,
      });
    }

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  return { reservations, count: reservations.length };
}

export async function recordFulfillment({
  row,
  lineItems,
  stripeSessionId,
}: {
  row: OrderRow;
  lineItems: DemoLineItem[];
  stripeSessionId?: string;
}): Promise<{ recordedAt: string; demoSessionId: string; scenario: DemoScenario }> {
  if (!isDemoStoreEnabled()) {
    await appendSheetOrder(row);
    return {
      recordedAt: new Date().toISOString(),
      demoSessionId: 'legacy-sheets',
      scenario: 'happy-path',
    };
  }

  await ensureDemoSchema();
  await maybeFailDemoStep(row.orderId, 'record-fulfillment');

  const [{ demoSessionId, scenario }] = await Promise.all([getDemoState()]);
  const pool = getPool();

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into demo_orders (
        order_id, demo_session_id, created_at, customer_email, customer_name,
        customer_phone, items, total_cents, currency, ship_address, ship_city,
        ship_state, ship_zip, ship_country, status, tracking, notes, scenario,
        stripe_session_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      on conflict (order_id) do update set
        demo_session_id = excluded.demo_session_id,
        customer_email = excluded.customer_email,
        customer_name = excluded.customer_name,
        customer_phone = excluded.customer_phone,
        items = excluded.items,
        total_cents = excluded.total_cents,
        currency = excluded.currency,
        ship_address = excluded.ship_address,
        ship_city = excluded.ship_city,
        ship_state = excluded.ship_state,
        ship_zip = excluded.ship_zip,
        ship_country = excluded.ship_country,
        status = excluded.status,
        tracking = excluded.tracking,
        notes = excluded.notes,
        scenario = excluded.scenario,
        stripe_session_id = excluded.stripe_session_id`,
      [
        row.orderId,
        demoSessionId,
        row.createdAt,
        row.email,
        row.name,
        row.phone,
        row.items,
        row.totalCents,
        row.currency,
        row.shipAddress,
        row.shipCity,
        row.shipState,
        row.shipZip,
        row.shipCountry,
        row.status,
        row.tracking,
        row.notes,
        scenario,
        stripeSessionId ?? null,
      ],
    );

    await client.query('delete from demo_order_items where order_id = $1', [row.orderId]);
    for (const item of lineItems ?? []) {
      await client.query(
        `insert into demo_order_items (
          order_id, product_id, variant_id, sku, name, size, color, quantity, amount_total
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          row.orderId,
          item.productId ?? null,
          item.variantId ?? null,
          item.sku ?? '',
          item.productName ?? item.description ?? 'item',
          item.size ?? '',
          item.color ?? '',
          item.quantity ?? 1,
          item.amountTotal ?? null,
        ],
      );
    }

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  return { recordedAt: new Date().toISOString(), demoSessionId, scenario };
}

export async function fetchDemoAnalytics(): Promise<DemoAnalytics> {
  if (!isDemoStoreEnabled()) return emptyAnalytics();

  await ensureDemoSchema();
  const demoSessionId = await getActiveDemoSessionId();
  const months = getLastSixMonths();
  const startDate = months[0]?.startDate ?? new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();

  const [ordersRes, topProductsRes] = await Promise.all([
    getPool().query(
      `select created_at, total_cents
       from demo_orders
       where demo_session_id = $1
         and created_at >= $2
       order by created_at asc`,
      [demoSessionId, startDate],
    ),
    getPool().query(
      `select i.name, sum(i.quantity)::int as quantity,
              coalesce(sum(i.amount_total), 0)::int as revenue_cents
       from demo_order_items i
       join demo_orders o on o.order_id = i.order_id
       where o.demo_session_id = $1
         and o.created_at >= $2
       group by i.name
       order by quantity desc, revenue_cents desc
       limit 5`,
      [demoSessionId, startDate],
    ),
  ]);

  const monthMap = new Map(
    months.map((month) => [
      month.key,
      {
        label: month.label,
        startDate: month.startDate,
        endDate: month.endDate,
        orders: 0,
        revenueCents: 0,
      },
    ]),
  );

  let totalOrders = 0;
  let totalRevenueCents = 0;
  let last30DaysOrders = 0;
  let last30DaysRevenueCents = 0;

  for (const row of ordersRes.rows) {
    const createdAt = new Date(row.created_at);
    const revenueCents = Number(row.total_cents ?? 0);
    const key = monthKey(createdAt);
    const bucket = monthMap.get(key);
    if (bucket) {
      bucket.orders += 1;
      bucket.revenueCents += revenueCents;
    }

    totalOrders += 1;
    totalRevenueCents += revenueCents;

    if (createdAt.getTime() >= new Date(thirtyDaysAgo).getTime()) {
      last30DaysOrders += 1;
      last30DaysRevenueCents += revenueCents;
    }
  }

  return {
    totalOrders,
    totalRevenueCents,
    last30DaysOrders,
    last30DaysRevenueCents,
    months: Array.from(monthMap.values()),
    topProducts: topProductsRes.rows.map((row) => ({
      name: String(row.name ?? 'Unknown item'),
      quantity: Number(row.quantity ?? 0),
      revenueCents: Number(row.revenue_cents ?? 0),
    })),
  };
}

export async function fetchPublicOrders(limit = 50): Promise<
  Array<{
    orderId: string;
    createdAt: string;
    items: string;
    status: string;
    tracking: string;
  }>
> {
  if (!isDemoStoreEnabled()) return fetchSheetPublicOrders(limit);

  await ensureDemoSchema();
  const res = await getPool().query(
    `select order_id, created_at, items, status, tracking
     from demo_orders
     order by created_at desc
     limit $1`,
    [limit],
  );

  return res.rows.map((row) => ({
    orderId: String(row.order_id),
    createdAt: new Date(row.created_at).toISOString(),
    items: String(row.items ?? ''),
    status: String(row.status ?? ''),
    tracking: String(row.tracking ?? ''),
  }));
}

export async function fetchOrder(orderId: string): Promise<OrderDetail | null> {
  if (!isDemoStoreEnabled()) return fetchSheetOrder(orderId);

  await ensureDemoSchema();
  const res = await getPool().query(
    `select order_id, created_at, customer_email, customer_name, items,
            total_cents, currency, status, tracking
     from demo_orders
     where order_id = $1
     limit 1`,
    [orderId],
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    orderId: String(row.order_id),
    createdAt: new Date(row.created_at).toISOString(),
    email: String(row.customer_email ?? ''),
    name: String(row.customer_name ?? ''),
    items: String(row.items ?? ''),
    totalCents: Number(row.total_cents ?? 0),
    currency: String(row.currency ?? 'USD'),
    status: String(row.status ?? ''),
    tracking: String(row.tracking ?? ''),
  };
}

async function seedCatalog(): Promise<void> {
  const pool = getPool();

  for (const product of PRODUCTS) {
    await pool.query(
      `insert into demo_products (id, slug, name, sku, price_cents, category, image)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         sku = excluded.sku,
         price_cents = excluded.price_cents,
         category = excluded.category,
         image = excluded.image`,
      [
        product.id,
        product.slug,
        product.name,
        product.sku,
        product.price,
        product.category,
        product.image,
      ],
    );

    for (const variant of product.variants) {
      await pool.query(
        `insert into demo_variants (
          id, product_id, sku, size, color, initial_stock, stock
        )
        values ($1, $2, $3, $4, $5, $6, $6)
        on conflict (id) do update set
          product_id = excluded.product_id,
          sku = excluded.sku,
          size = excluded.size,
          color = excluded.color,
          initial_stock = excluded.initial_stock,
          stock = excluded.initial_stock,
          updated_at = now()`,
        [
          variant.id,
          product.id,
          product.sku,
          variant.size ?? '',
          variant.color ?? '',
          variant.stock,
        ],
      );
    }
  }
}

async function seedCompletedOrders(demoSessionId: string): Promise<void> {
  const { rows, items } = buildSeedOrders(demoSessionId);
  await insertSeedOrders(rows);
  await insertSeedOrderItems(items);
}

async function findVariantForUpdate(client: PoolClient, item: DemoLineItem): Promise<{
  id: string;
  sku: string;
  name: string;
  size: string;
  color: string;
  stock: number;
} | null> {
  const res = await client.query(
    `select v.id, v.sku, p.name, v.size, v.color, v.stock
     from demo_variants v
     join demo_products p on p.id = v.product_id
     where ($1::text is not null and v.id = $1)
        or ($1::text is null and $2::text is not null and v.sku = $2)
     order by v.id
     limit 1
     for update of v`,
    [item.variantId ?? null, item.sku ?? null],
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    sku: String(row.sku),
    name: String(row.name),
    size: String(row.size ?? ''),
    color: String(row.color ?? ''),
    stock: Number(row.stock ?? 0),
  };
}

async function maybeFailDemoStep(orderId: string, stepName: string): Promise<void> {
  const scenario = await getActiveScenario();
  const attempts = await incrementStepAttempt(orderId, stepName);

  if (scenario === 'flaky-inventory' && stepName === 'reserve-inventory' && attempts <= 2) {
    throw new Error('DEMO_FAILURE: Warehouse API returned 503 while reserving inventory');
  }

  if (scenario === 'broken-fulfillment' && stepName === 'record-fulfillment') {
    throw new Error('DEMO_FAILURE: Supplier fulfillment endpoint is currently down');
  }

  if (scenario === 'regional-outage' && stepName === 'record-fulfillment' && attempts <= 2) {
    throw new Error(
      'DEMO_RECOVERABLE_FAILURE: AWS us-east-1 fulfillment gateway timed out; retry after regional failover',
    );
  }
}

async function incrementStepAttempt(orderId: string, stepName: string): Promise<number> {
  const res = await getPool().query(
    `insert into demo_step_attempts (order_id, step_name, attempts)
     values ($1, $2, 1)
     on conflict (order_id, step_name)
     do update set attempts = demo_step_attempts.attempts + 1
     returning attempts`,
    [orderId, stepName],
  );

  return Number(res.rows[0]?.attempts ?? 1);
}

async function getActiveDemoSessionId(): Promise<string> {
  const existing = await getStateValue<string>('active_session_id');
  if (existing) return existing;

  const demoSessionId = `demo_${Date.now().toString(36)}`;
  await getPool().query(
    `insert into demo_sessions (id, label)
     values ($1, $2)
     on conflict (id) do nothing`,
    [demoSessionId, 'Active demo session'],
  );
  await setStateValue('active_session_id', demoSessionId);
  return demoSessionId;
}

async function getActiveScenario(): Promise<DemoScenario> {
  const value = await getStateValue<DemoScenario>('active_scenario');
  return isDemoScenario(value) ? value : 'happy-path';
}

function isDemoScenario(value: unknown): value is DemoScenario {
  return (
    value === 'happy-path' ||
    value === 'flaky-inventory' ||
    value === 'broken-fulfillment' ||
    value === 'regional-outage'
  );
}

type SeedOrder = {
  orderId: string;
  demoSessionId: string;
  createdAt: string;
  email: string;
  name: string;
  phone: string;
  items: string;
  totalCents: number;
  currency: string;
  shipAddress: string;
  shipCity: string;
  shipState: string;
  shipZip: string;
  shipCountry: string;
  status: string;
  tracking: string;
  notes: string;
  scenario: DemoScenario;
  stripeSessionId: string | null;
};

type SeedOrderItem = {
  orderId: string;
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  size: string;
  color: string;
  quantity: number;
  amountTotal: number;
};

function buildSeedOrders(demoSessionId: string): {
  rows: SeedOrder[];
  items: SeedOrderItem[];
} {
  const rows: SeedOrder[] = [];
  const items: SeedOrderItem[] = [];
  const rand = seededRandom(20260520);
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const products = PRODUCTS.map((product, index) => ({
    product,
    weight: [34, 22, 30, 14][index] ?? 10,
  }));
  const buyerNames = [
    'Ada Lovelace',
    'Grace Hopper',
    'Katherine Johnson',
    'Margaret Hamilton',
    'Barbara Liskov',
    'Radia Perlman',
    'Evelyn Boyd',
    'Mary Jackson',
  ];
  const cities = [
    ['San Francisco', 'CA', '94107'],
    ['New York', 'NY', '10013'],
    ['Austin', 'TX', '78701'],
    ['Seattle', 'WA', '98101'],
    ['Denver', 'CO', '80202'],
    ['Atlanta', 'GA', '30303'],
  ];

  let orderNumber = 1;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dayOfWeek = cursor.getUTCDay();
    const monthIndex =
      (cursor.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      cursor.getUTCMonth() -
      start.getUTCMonth();
    const weekdayLift = dayOfWeek >= 1 && dayOfWeek <= 4 ? 1 : 0;
    const launchLift = monthIndex === 4 && cursor.getUTCDate() >= 8 && cursor.getUTCDate() <= 18 ? 2 : 0;
    const meetupLift = dayOfWeek === 3 && rand() > 0.45 ? 2 : 0;
    const baseline = 1 + Math.floor(monthIndex / 2) + weekdayLift + launchLift + meetupLift;
    const orderCount = Math.max(1, baseline + Math.floor(rand() * 3));

    for (let i = 0; i < orderCount; i += 1) {
      const createdAt = new Date(cursor);
      createdAt.setUTCHours(14 + Math.floor(rand() * 9), Math.floor(rand() * 60), Math.floor(rand() * 60));

      const orderId = `ord_seed_${String(orderNumber).padStart(4, '0')}`;
      const name = buyerNames[Math.floor(rand() * buyerNames.length)] ?? 'Demo Buyer';
      const [city, state, zip] = cities[Math.floor(rand() * cities.length)] ?? cities[0];
      const lineCount = rand() > 0.72 ? 2 : 1;
      const orderItems: SeedOrderItem[] = [];

      for (let line = 0; line < lineCount; line += 1) {
        const product = weightedPick(products, rand).product;
        const variant = product.variants[Math.floor(rand() * product.variants.length)] ?? product.variants[0];
        const quantity = product.category === 'accessories' && rand() > 0.62 ? 2 : 1;

        orderItems.push({
          orderId,
          productId: product.id,
          variantId: variant.id,
          sku: product.sku,
          name: product.name,
          size: variant.size ?? '',
          color: variant.color ?? '',
          quantity,
          amountTotal: product.price * quantity,
        });
      }

      const totalCents = orderItems.reduce((sum, item) => sum + item.amountTotal, 0);
      const itemsLabel = orderItems
        .map((item) => {
          const variant = [item.size, item.color].filter(Boolean).join('/');
          const variantTag = variant ? ` (${variant})` : '';
          const qtyTag = item.quantity > 1 ? ` x ${item.quantity}` : '';
          return `${item.name}${variantTag}${qtyTag}`;
        })
        .join(', ');

      rows.push({
        orderId,
        demoSessionId,
        createdAt: createdAt.toISOString(),
        email: `buyer${orderNumber}@example.com`,
        name,
        phone: '',
        items: itemsLabel,
        totalCents,
        currency: 'USD',
        shipAddress: `${100 + Math.floor(rand() * 899)} Durable Way`,
        shipCity: city,
        shipState: state,
        shipZip: zip,
        shipCountry: 'US',
        status: 'ready_to_ship',
        tracking: '',
        notes: 'six-month seeded trend order',
        scenario: 'happy-path',
        stripeSessionId: null,
      });
      items.push(...orderItems);
      orderNumber += 1;
    }
  }

  return { rows, items };
}

async function insertSeedOrders(rows: SeedOrder[]): Promise<void> {
  const columns = [
    'order_id',
    'demo_session_id',
    'created_at',
    'customer_email',
    'customer_name',
    'customer_phone',
    'items',
    'total_cents',
    'currency',
    'ship_address',
    'ship_city',
    'ship_state',
    'ship_zip',
    'ship_country',
    'status',
    'tracking',
    'notes',
    'scenario',
    'stripe_session_id',
  ];

  const values = rows.map((row) => [
    row.orderId,
    row.demoSessionId,
    row.createdAt,
    row.email,
    row.name,
    row.phone,
    row.items,
    row.totalCents,
    row.currency,
    row.shipAddress,
    row.shipCity,
    row.shipState,
    row.shipZip,
    row.shipCountry,
    row.status,
    row.tracking,
    row.notes,
    row.scenario,
    row.stripeSessionId,
  ]);

  await insertInChunks(
    'demo_orders',
    columns,
    values,
    'on conflict (order_id) do nothing',
  );
}

async function insertSeedOrderItems(items: SeedOrderItem[]): Promise<void> {
  const columns = [
    'order_id',
    'product_id',
    'variant_id',
    'sku',
    'name',
    'size',
    'color',
    'quantity',
    'amount_total',
  ];

  const values = items.map((item) => [
    item.orderId,
    item.productId,
    item.variantId,
    item.sku,
    item.name,
    item.size,
    item.color,
    item.quantity,
    item.amountTotal,
  ]);

  await insertInChunks('demo_order_items', columns, values);
}

async function insertInChunks(
  table: 'demo_orders' | 'demo_order_items',
  columns: string[],
  values: Array<Array<string | number | null>>,
  conflictClause = '',
): Promise<void> {
  const chunkSize = 100;
  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize);
    const params = chunk.flat();
    const rowsSql = chunk
      .map((row, rowIndex) => {
        const placeholders = row.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`);
        return `(${placeholders.join(', ')})`;
      })
      .join(', ');

    await getPool().query(
      `insert into ${table} (${columns.join(', ')})
       values ${rowsSql}
       ${conflictClause}`,
      params,
    );
  }
}

function emptyAnalytics(): DemoAnalytics {
  return {
    totalOrders: 0,
    totalRevenueCents: 0,
    last30DaysOrders: 0,
    last30DaysRevenueCents: 0,
    months: getLastSixMonths().map((month) => ({
      label: month.label,
      startDate: month.startDate,
      endDate: month.endDate,
      orders: 0,
      revenueCents: 0,
    })),
    topProducts: [],
  };
}

function getLastSixMonths(): Array<{
  key: string;
  label: string;
  startDate: string;
  endDate: string;
}> {
  const now = new Date();
  const months: Array<{
    key: string;
    label: string;
    startDate: string;
    endDate: string;
  }> = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    months.push({
      key: monthKey(start),
      label: start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
  }

  return months;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function weightedPick<T extends { weight: number }>(items: T[], rand: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rand() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

async function setStateValue(key: string, value: string): Promise<void> {
  await getPool().query(
    `insert into demo_system_state (key, value, updated_at)
     values ($1, to_jsonb($2::text), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  );
}

async function getStateValue<T extends string>(key: string): Promise<T | null> {
  const res = await getPool().query('select value from demo_system_state where key = $1', [
    key,
  ]);
  return (res.rows[0]?.value as T | undefined) ?? null;
}

export async function withDemoTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
