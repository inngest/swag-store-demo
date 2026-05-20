import { NextRequest, NextResponse } from 'next/server';
import {
  type DemoScenario,
  getDemoState,
  setDemoScenario,
} from '@/lib/demo-store';
import { authorizeDemoSecret } from '@/lib/demo-auth';

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
  return authorizeDemoSecret({
    auth: req.headers.get('authorization'),
    configuredSecret: process.env.DEMO_RESET_SECRET,
    header: req.headers.get('x-demo-reset-secret'),
  });
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
