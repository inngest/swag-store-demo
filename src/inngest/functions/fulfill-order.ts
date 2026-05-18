import { inngest } from '../client';
import { orderChannel, adminChannel } from '../channels';
import { recordFulfillment, reserveInventory } from '@/lib/demo-store';
import { getStripe } from '@/lib/stripe';

type LineItem = {
  description: string | null;
  quantity: number | null;
  amountTotal: number | null;
  priceId?: string;
  productId?: string;
  productName?: string;
  sku?: string;
  variantId?: string;
  size?: string;
  color?: string;
};

type ShippingInfo = {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
} | null;

export const fulfillOrder = inngest.createFunction(
  {
    id: 'fulfill-order',
    name: 'Fulfill Order',
    retries: 3,
    triggers: [{ event: 'store/order.placed' }],
  },
  async ({ event, step }) => {
    const data = event.data as {
      orderId: string;
      stripePaymentIntentId?: string;
      encrypted?: {
        customerEmail?: string;
        customerName?: string | null;
        customerPhone?: string | null;
        shipping?: ShippingInfo;
      };
      lineItems: LineItem[];
      amountTotal: number;
      currency: string;
      stripeSessionId?: string;
      demo?: {
        sessionId?: string;
        scenario?: string;
      };
      metadata?: Record<string, string>;
    };

    const {
      orderId,
      stripePaymentIntentId,
      lineItems,
      amountTotal,
      currency,
    } = data;
    const customerEmail = data.encrypted?.customerEmail;
    const customerName = data.encrypted?.customerName ?? null;
    const customerPhone = data.encrypted?.customerPhone ?? null;
    const shipping = data.encrypted?.shipping ?? null;

    const adminItems = (lineItems ?? []).map((li) => ({
      name: li.productName ?? li.description ?? 'item',
      quantity: li.quantity ?? 1,
    }));

    const emit = async (
      name: string,
      status: 'running' | 'complete' | 'failed',
      output?: Record<string, unknown>,
    ) => {
      const ts = Date.now();
      await step.realtime.publish(
        `emit-${name}-${status}`,
        orderChannel(orderId).step,
        { name, status, output, ts },
      );
      await step.realtime.publish(
        `emit-admin-${name}-${status}`,
        adminChannel.order,
        {
          orderId,
          customerEmail,
          amount: amountTotal,
          currency,
          items: adminItems,
          step: name,
          status,
          ts,
        },
      );
    };

    await emit('capture-payment', 'running');
    let payment: {
      paymentIntentId?: string;
      status: string;
      amount: number;
      currency: string;
    };
    try {
      payment = await step.run('capture-payment', async () => {
        if (!stripePaymentIntentId) {
          return { status: 'mocked', amount: amountTotal, currency };
        }
        const pi = await getStripe().paymentIntents.retrieve(stripePaymentIntentId);
        if (pi.status !== 'succeeded') {
          throw new Error(`PaymentIntent ${pi.id} not succeeded: ${pi.status}`);
        }
        return {
          paymentIntentId: pi.id,
          status: pi.status,
          amount: pi.amount,
          currency: pi.currency,
        };
      });
    } catch (err) {
      await emit('capture-payment', 'failed', { error: errorMessage(err) });
      throw err;
    }
    await emit('capture-payment', 'complete', payment);

    await emit('reserve-inventory', 'running');
    let inventory: {
      reservations: Array<{
        sku: string;
        name: string;
        size: string;
        color: string;
        quantity: number;
        reservedAt: string;
      }>;
      count: number;
    };
    try {
      inventory = await step.run('reserve-inventory', async () => {
        const { reservations } = await reserveInventory({ orderId, lineItems });
        console.log(`[fulfill-order] reserved inventory for ${orderId}:`, reservations);
        return { reservations, count: reservations.length };
      });
    } catch (err) {
      await emit('reserve-inventory', 'failed', { error: errorMessage(err) });
      throw err;
    }
    await emit('reserve-inventory', 'complete', inventory);

    await emit('send-confirmation', 'running');
    let confirmation: { sentAt: string; sent: boolean };
    try {
      confirmation = await step.run('send-confirmation', async () => {
        const payload = {
          to: customerEmail ?? 'unknown@example.com',
          subject: `Your Inngest swag order ${orderId} is confirmed`,
          body: {
            orderId,
            items: inventory.reservations,
            total: amountTotal,
            currency,
          },
        };
        console.log(`[fulfill-order] mock email sent for ${orderId}:`, payload);
        // Returned output stays PII-free — sent flag only. Encryption middleware
        // will still encrypt this in Inngest storage, but realtime subscribers
        // (admin/order page) can render it without leaking the email.
        return { sentAt: new Date().toISOString(), sent: true };
      });
    } catch (err) {
      await emit('send-confirmation', 'failed', { error: errorMessage(err) });
      throw err;
    }
    await emit('send-confirmation', 'complete', confirmation);

    await emit('record-fulfillment', 'running');
    let recorded: { recordedAt: string; demoSessionId: string; scenario: string };
    try {
      recorded = await step.run('record-fulfillment', async () => {
        const itemsLabel = inventory.reservations
          .map((r) => {
            const variant = [r.size, r.color].filter(Boolean).join('/');
            const variantTag = variant ? ` (${variant})` : '';
            const qtyTag = r.quantity > 1 ? ` × ${r.quantity}` : '';
            return `${r.name}${variantTag}${qtyTag}`;
          })
          .join(', ');

        return recordFulfillment({
          row: {
            orderId,
            createdAt: new Date().toISOString(),
            email: customerEmail ?? '',
            name: customerName ?? '',
            items: itemsLabel,
            totalCents: amountTotal,
            currency: (currency ?? 'usd').toUpperCase(),
            shipAddress: [shipping?.line1, shipping?.line2].filter(Boolean).join(', '),
            shipCity: shipping?.city ?? '',
            shipState: shipping?.state ?? '',
            shipZip: shipping?.postalCode ?? '',
            shipCountry: shipping?.country ?? '',
            phone: customerPhone ?? '',
            status: 'ready_to_ship',
            tracking: '',
            notes: '',
          },
          lineItems,
          stripeSessionId: data.stripeSessionId,
        });
      });
    } catch (err) {
      await emit('record-fulfillment', 'failed', { error: errorMessage(err) });
      throw err;
    }
    await emit('record-fulfillment', 'complete', recorded);

    return {
      orderId,
      status: 'fulfilled',
      payment,
      inventory,
      confirmation,
      recorded,
    };
  }
);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
