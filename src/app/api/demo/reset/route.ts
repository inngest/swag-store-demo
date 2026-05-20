import { NextRequest, NextResponse } from 'next/server';
import {
  type DemoScenario,
  resetDemoStore,
} from '@/lib/demo-store';

export async function POST(req: NextRequest) {
  const auth = authorizeDemoMutation(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  try {
    const body = await readJson(req);
    const scenario = parseScenario(body.scenario);
    const seedOrders = Boolean(body.seedOrders);
    const state = await resetDemoStore({ scenario, seedOrders });

    return NextResponse.json({
      ok: true,
      ...state,
      seedOrders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Demo reset failed';
    console.error('[demo/reset] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function authorizeDemoMutation(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const secret = process.env.DEMO_RESET_SECRET;
  if (!secret) return { ok: true };

  const auth = req.headers.get('authorization');
  const header = req.headers.get('x-demo-reset-secret');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;

  if (header === secret || bearer === secret) return { ok: true };
  return { ok: false, error: 'unauthorized' };
}

async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseScenario(value: unknown): DemoScenario {
  if (
    value === 'happy-path' ||
    value === 'flaky-inventory' ||
    value === 'broken-fulfillment' ||
    value === 'regional-outage'
  ) {
    return value;
  }
  return 'happy-path';
}
