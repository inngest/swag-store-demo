import { NextRequest, NextResponse } from 'next/server';
import {
  type DemoScenario,
  getDemoState,
  setDemoScenario,
} from '@/lib/demo-store';

export async function GET() {
  try {
    return NextResponse.json(await getDemoState());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to read demo scenario';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = authorizeDemoMutation(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const scenario = parseScenario(body.scenario);
    return NextResponse.json({ ok: true, ...(await setDemoScenario(scenario)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to set demo scenario';
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

function parseScenario(value: unknown): DemoScenario {
  if (
    value === 'happy-path' ||
    value === 'flaky-inventory' ||
    value === 'broken-fulfillment'
  ) {
    return value;
  }
  return 'happy-path';
}
