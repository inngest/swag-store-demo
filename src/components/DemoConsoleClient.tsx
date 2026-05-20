'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CloudLightning,
  CheckCircle2,
  ExternalLink,
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

type Notice = {
  kind: 'info' | 'error' | 'success';
  message: string;
};

const SCENARIOS: Array<{
  id: DemoScenario;
  label: string;
  eyebrow: string;
  summary: string;
  audience: string;
  inngest: string;
  recovery: string;
  presenter: string[];
  icon: React.ComponentType<{ size?: number }>;
}> = [
  {
    id: 'happy-path',
    label: 'Happy path',
    eyebrow: 'Baseline order',
    summary: 'The purchase flows through payment, inventory, email, and fulfillment without drama.',
    audience: 'The order tracker advances step by step and ends fulfilled.',
    inngest: 'Open the run to show each step output and the durable function timeline.',
    recovery: 'No intervention needed. This is the normal production path.',
    presenter: ['Reset with seeded data', 'Buy one item in the store', 'Open Live tracker', 'Open the completed Inngest run'],
    icon: CheckCircle2,
  },
  {
    id: 'flaky-inventory',
    label: 'Flaky inventory',
    eyebrow: 'Transient 503',
    summary: 'Inventory reservation throws twice, then succeeds on retry.',
    audience: 'The run pauses on reserve-inventory before it recovers.',
    inngest: 'Filter runs by swag-store-demo and open the run to show failed attempts and retry history.',
    recovery: 'Inngest retries the failed step; the order finishes after inventory comes back.',
    presenter: ['Pick this scenario', 'Place a small order', 'Show the failed reserve-inventory attempts', 'Wait for the retry to complete'],
    icon: AlertTriangle,
  },
  {
    id: 'regional-outage',
    label: 'Regional outage',
    eyebrow: 'Recoverable outage',
    summary: 'Fulfillment fails as if us-east-1 timed out. Flip back to Happy path to simulate failover.',
    audience: 'Payment, inventory, and email complete; fulfillment fails and waits for retry.',
    inngest: 'Open the failed record-fulfillment step, then show the same run succeed after failover.',
    recovery: 'Switch scenario to Happy path. The pending retry records fulfillment successfully.',
    presenter: ['Pick Regional outage', 'Place an order', 'Show record-fulfillment failing', 'Switch to Happy path', 'Return to the run after retry'],
    icon: CloudLightning,
  },
  {
    id: 'broken-fulfillment',
    label: 'Broken fulfillment',
    eyebrow: 'Hard failure',
    summary: 'The supplier endpoint stays down so fulfillment keeps failing.',
    audience: 'The order never reaches fulfilled until the scenario changes or the run is handled.',
    inngest: 'Use this to walk through error details, attempts, logs, and where ops would investigate.',
    recovery: 'Reset or change to Happy path when you are ready to leave the broken state.',
    presenter: ['Pick Broken fulfillment', 'Place an order', 'Open the failed run', 'Explain retries, observability, and recovery options'],
    icon: Wrench,
  },
];

const RUNS_URL = 'https://app.inngest.com/env/production/runs';

export function DemoConsoleClient() {
  const [state, setState] = React.useState<DemoState>({});
  const [selectedScenario, setSelectedScenario] = React.useState<DemoScenario>('happy-path');
  const [secret, setSecret] = React.useState('');
  const [seedOrders, setSeedOrders] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const activeScenario = SCENARIOS.find((scenario) => scenario.id === selectedScenario) ?? SCENARIOS[0];
  const liveScenario = SCENARIOS.find((scenario) => scenario.id === state.scenario);
  const isPreviewing = Boolean(state.scenario && selectedScenario !== state.scenario);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await requestDemo('/api/demo/scenario');
      if (cancelled) return;
      if (next.scenario) {
        setSelectedScenario(next.scenario);
        setNotice(null);
      } else if (next.error) {
        setNotice({ kind: 'error', message: next.error });
      }
      setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setScenario(scenario: DemoScenario) {
    setSelectedScenario(scenario);
    const label = SCENARIOS.find((item) => item.id === scenario)?.label ?? 'scenario';

    if (scenario === state.scenario) {
      setNotice({
        kind: 'info',
        message: `${label} is already live for new purchases.`,
      });
      return;
    }

    setNotice({
      kind: 'info',
      message: `Previewing ${label}. Click Apply selected scenario to make it live for new purchases.`,
    });
  }

  async function applyScenario(scenario: DemoScenario = selectedScenario) {
    if (!secret.trim()) {
      setNotice({
        kind: 'info',
        message: 'Enter the reset secret to apply this scenario to the live demo.',
      });
      return;
    }

    setBusy(`scenario:${scenario}`);
    const next = await requestDemo('/api/demo/scenario', {
      method: 'POST',
      secret,
      body: { scenario },
    });
    if (next.error) {
      setNotice({ kind: 'error', message: next.error });
    } else {
      setState(next);
      if (next.scenario) setSelectedScenario(next.scenario);
      const label = SCENARIOS.find((item) => item.id === next.scenario)?.label ?? 'scenario';
      setNotice({ kind: 'success', message: `${label} is now live for new purchases.` });
    }
    setBusy(null);
  }

  async function reset(scenario: DemoScenario = selectedScenario) {
    if (!secret.trim()) {
      setNotice({
        kind: 'info',
        message: 'Enter the reset secret to reset inventory, seeded data, and the live scenario.',
      });
      return;
    }

    setBusy('reset');
    const next = await requestDemo('/api/demo/reset', {
      method: 'POST',
      secret,
      body: { scenario, seedOrders },
    });
    if (next.error) {
      setNotice({ kind: 'error', message: next.error });
    } else {
      setState(next);
      if (next.scenario) setSelectedScenario(next.scenario);
      setNotice({
        kind: 'success',
        message: `Reset complete. ${seedOrders ? 'Six months of trend data was seeded.' : 'Trend seed data was skipped.'}`,
      });
    }
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

      <section style={{ padding: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 24, alignItems: 'start' }}>
        <div style={{ border: '1px solid var(--ink)', display: 'grid', alignContent: 'start' }}>
          <div style={{ padding: 24, borderBottom: '1px solid var(--ink)', display: 'grid', gap: 14 }}>
            <div className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              ACTIVE DEMO STORY
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start' }}>
              <div>
                <div className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 8 }}>
                  {activeScenario.eyebrow}
                </div>
                <h2 className="display" style={{ fontSize: 42, lineHeight: 0.95, fontWeight: 400, textTransform: 'uppercase', margin: 0 }}>
                  {activeScenario.label}
                </h2>
              </div>
              <div style={{ display: 'grid', justifyItems: 'end', gap: 8 }}>
                <StatusPill label={isPreviewing ? 'Preview' : 'Selected'} />
                <div className="mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                  Live: {liveScenario?.label ?? 'loading'}
                </div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--muted)', maxWidth: 620 }}>
              {activeScenario.summary}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', borderBottom: '1px solid var(--ink)' }}>
            <StoryBlock label="Buyer sees" value={activeScenario.audience} />
            <StoryBlock label="Inngest moment" value={activeScenario.inngest} />
            <StoryBlock label="Recovery beat" value={activeScenario.recovery} />
            <StoryBlock label="Session" value={state.demoSessionId ?? 'not initialized'} mono />
          </div>

          <div style={{ padding: 24, display: 'grid', gap: 14 }}>
            <div className="mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              PRESENTER BEATS
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {activeScenario.presenter.map((beat, index) => (
                <div key={beat} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12, alignItems: 'center' }}>
                  <span className="mono tabnum" style={{ width: 28, height: 28, border: '1px solid var(--ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                    {index + 1}
                  </span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>{beat}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 6 }}>
              <Link className="btn" href="/" style={{ justifyContent: 'center', background: 'transparent', color: 'var(--ink)' }}>
                Store
              </Link>
              <Link className="btn" href="/admin" style={{ justifyContent: 'center', background: 'transparent', color: 'var(--ink)' }}>
                Tracker
              </Link>
              <Link className="btn" href={RUNS_URL} target="_blank" style={{ justifyContent: 'center', background: 'var(--ink)', color: 'var(--paper)' }}>
                Runs
                <ExternalLink size={14} />
              </Link>
            </div>
          </div>

          {notice && (
            <NoticePanel notice={notice} />
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
            <div style={{ display: 'grid', gap: 8 }}>
              {SCENARIOS.map((scenario) => (
                <ScenarioButton
                  key={scenario.id}
                  active={selectedScenario === scenario.id}
                  applied={state.scenario === scenario.id}
                  busy={busy === `scenario:${scenario.id}`}
                  icon={scenario.icon}
                  label={scenario.label}
                  eyebrow={scenario.eyebrow}
                  summary={scenario.summary}
                  onClick={() => setScenario(scenario.id)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => applyScenario()}
              disabled={busy?.startsWith('scenario:')}
              className="btn"
              style={{ width: '100%', justifyContent: 'center', background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' }}
            >
              <Save size={16} />
              {busy?.startsWith('scenario:') ? 'Applying' : 'Apply selected scenario'}
            </button>
          </div>

          <div style={{ border: '1px solid var(--ink)', padding: 20, display: 'grid', gap: 14 }}>
            <label className="mono" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                checked={seedOrders}
                onChange={(e) => setSeedOrders(e.target.checked)}
                type="checkbox"
              />
              Seed 6 months of tracker data
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
  applied,
  busy,
  eyebrow,
  icon: Icon,
  label,
  summary,
  onClick,
}: {
  active: boolean;
  applied: boolean;
  busy: boolean;
  eyebrow: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  summary: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        minHeight: 108,
        border: '1px solid var(--ink)',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink)',
        display: 'grid',
        gridTemplateColumns: '32px 1fr',
        gap: 12,
        padding: 14,
        cursor: busy ? 'wait' : 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ width: 32, height: 32, border: active ? '1px solid var(--paper)' : '1px solid var(--ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <Save size={17} /> : <Icon size={17} />}
      </span>
      <span style={{ display: 'grid', gap: 5 }}>
        <span className="mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.72 }}>
          {eyebrow}
        </span>
        <span className="mono" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        <span style={{ fontSize: 12.5, lineHeight: 1.35, color: active ? 'var(--paper)' : 'var(--muted)' }}>
          {summary}
        </span>
        {applied && (
          <span className="mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: active ? 'var(--paper)' : 'var(--ink)' }}>
            live for purchases
          </span>
        )}
      </span>
    </button>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="mono" style={{ display: 'inline-flex', border: '1px solid var(--ink)', padding: '8px 10px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </span>
  );
}

function NoticePanel({ notice }: { notice: Notice }) {
  const color =
    notice.kind === 'error'
      ? 'var(--danger, #ad2f2f)'
      : notice.kind === 'success'
        ? 'var(--success, #1f7a42)'
        : 'var(--muted)';

  return (
    <div className="mono" style={{ borderTop: '1px solid var(--ink)', padding: 18, color, fontSize: 12, lineHeight: 1.5 }}>
      {notice.message}
    </div>
  );
}

function StoryBlock({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ padding: 20, borderRight: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', minHeight: 128 }}>
      <div className="mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 10 }}>
        {label}
      </div>
      <div className={mono ? 'mono' : undefined} style={{ fontSize: mono ? 12 : 13.5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
        {value}
      </div>
    </div>
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
    const secret = options.secret?.trim();
    if (secret) headers.set('x-demo-reset-secret', secret);

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
