import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { sendOrderPlacedEventFromCheckoutSession } from '@/lib/stripe-order-event';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { orderId?: string; sessionId?: string };
    const orderId = body.orderId?.trim();
    const sessionId = body.sessionId?.trim();

    if (!orderId || !sessionId) {
      return NextResponse.json({ error: 'orderId and sessionId are required' }, { status: 400 });
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.orderId !== orderId) {
      return NextResponse.json({ error: 'session does not match order' }, { status: 400 });
    }

    const sent = await sendOrderPlacedEventFromCheckoutSession(session, 'confirmation-fallback');
    return NextResponse.json({ ok: true, ...sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to replay order';
    console.error('[orders/replay] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
