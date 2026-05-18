'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Save,
  Wrench,
} from 'lucide-react';
import type { DemoScenario } from '@/lib/demo-store';

type DemoState = {
  demoSessionId?: string;
  scenario?: DemoScenario;
  error?: string;
};

const SCENARIOS: Array<{
  id: DemoScenario;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: 'happy-path', label: 'Happy path', icon: CheckCircle2 },
  { id: 'flaky-inventory', label: 'Flaky inventory', icon: AlertTriangle },
  { id: 'broken-fulfillment', label: 'Broken fulfillment', icon: Wrench },
];

export function DemoConsoleClient() {
  const [state, setState] = React.useState<DemoState>({});
  const [secret, setSecret] = React.useState('');
  const [seedOrders, setSeedOrders] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await requestDemo('/api/demo/scenario');
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function setScenario(scenario: DemoScenario) {
    setBusy(`scenario:${scenario}`);
    const next = await requestDemo('/api/demo/scenario', {
      method: 'POST',
      secret,
      body: { scenario },
    });
    setState(next);
    setBusy(null);
  }

  async function reset(scenario: DemoScenario = state.scenario ?? 'happy-path') {
    setBusy('reset');
    const next = await requestDemo('/api/demo/reset', {
      method: 'POST',
      secret,
      body: { scenario, seedOrders },
    });
    setState(next);
    setBusy(null);
  }

  return (
    <main style={{ minHeight: '100svh', background: 'var(--paper)', color: 'var(--ink)' }}>
      <div style={{ borderBottom: '1px solid var(--ink)', padding: '28px 32px', display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'end' }}>
        <div>
          <div className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 12 }}>
            DEMO CONTROL · swag.demo.inngest.com
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(48px, 7vw, 96px)', lineHeight: 0.9, fontWeight: 400, textTransform: 'uppercase', margin: 0 }}>
            Run the room.
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Link className="btn" href="/" style={{ background: 'transparent', color: 'var(--ink)' }}>
            Store
          </Link>
          <Link className="btn" href="/admin" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
            Live tracker
          </Link>
        </div>
      </div>

      <section style={{ padding: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        <div style={{ border: '1px solid var(--ink)', padding: 20, display: 'grid', gap: 18, alignContent: 'start' }}>
          <div className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
            CURRENT SESSION
          </div>
          <div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              ID
            </div>
            <div className="mono" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
              {state.demoSessionId ?? 'not initialized'}
            </div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              SCENARIO
            </div>
            <StatusPill scenario={state.scenario} />
          </div>
          {state.error && (
            <div className="mono" style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 14, color: 'var(--danger, #ad2f2f)', fontSize: 12, lineHeight: 1.5 }}>
              {state.error}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ border: '1px solid var(--ink)', padding: 20 }}>
            <label className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={14} />
              Reset secret
            </label>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="optional locally"
              type="password"
              style={{ marginTop: 12, width: '100%', border: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)', padding: '12px 14px', fontSize: 14 }}
            />
          </div>

          <div style={{ border: '1px solid var(--ink)', padding: 20, display: 'grid', gap: 14 }}>
            <div className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              SCENARIOS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {SCENARIOS.map((scenario) => (
                <ScenarioButton
                  key={scenario.id}
                  active={state.scenario === scenario.id}
                  busy={busy === `scenario:${scenario.id}`}
                  icon={scenario.icon}
                  label={scenario.label}
                  onClick={() => setScenario(scenario.id)}
                />
              ))}
            </div>
          </div>

          <div style={{ border: '1px solid var(--ink)', padding: 20, display: 'grid', gap: 14 }}>
            <label className="mono" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                checked={seedOrders}
                onChange={(e) => setSeedOrders(e.target.checked)}
                type="checkbox"
              />
              Seed admin tracker
            </label>
            <button
              type="button"
              onClick={() => reset()}
              disabled={busy === 'reset'}
              className="btn"
              style={{ width: '100%', justifyContent: 'center', background: 'var(--citrus)', color: 'var(--ink)', borderColor: 'var(--ink)' }}
            >
              <RotateCcw size={16} />
              {busy === 'reset' ? 'Resetting' : 'Reset everything'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ScenarioButton({
  active,
  busy,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  busy: boolean;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        minHeight: 92,
        border: '1px solid var(--ink)',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink)',
        display: 'grid',
        placeItems: 'center',
        gap: 8,
        padding: 12,
        cursor: busy ? 'wait' : 'pointer',
      }}
    >
      {busy ? <Save size={18} /> : <Icon size={18} />}
      <span className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>
        {label}
      </span>
    </button>
  );
}

function StatusPill({ scenario }: { scenario?: DemoScenario }) {
  const label = SCENARIOS.find((s) => s.id === scenario)?.label ?? 'Unknown';
  return (
    <span className="mono" style={{ display: 'inline-flex', border: '1px solid var(--ink)', padding: '8px 10px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </span>
  );
}

async function requestDemo(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    secret?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<DemoState> {
  try {
    const headers = new Headers();
    if (options.body) headers.set('content-type', 'application/json');
    if (options.secret) headers.set('x-demo-reset-secret', options.secret);

    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = (await res.json()) as DemoState;
    if (!res.ok) return { error: data.error ?? `Request failed: ${res.status}` };
    return data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
