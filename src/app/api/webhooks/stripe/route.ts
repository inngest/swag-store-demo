import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { sendOrderPlacedEventFromCheckoutSession } from '@/lib/stripe-order-event';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid signature';
    console.error('[stripe-webhook] signature verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    await sendOrderPlacedEventFromCheckoutSession(event.data.object, 'stripe-webhook');
  }

  return NextResponse.json({ received: true });
}
