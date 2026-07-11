// app/autopilot/page.tsx

import Link from 'next/link';
import KillSwitchControl from './KillSwitchControl';

const cards = [
  {
    title: 'Mode',
    value: 'Paper Only',
    detail: 'Live trading is disabled. Sprint 1B adds framework plumbing only.',
  },
  {
    title: 'Execution',
    value: 'Dry Run',
    detail: 'Manual and cron endpoints log framework runs but do not scan or trade.',
  },
  {
    title: 'Safety',
    value: 'No Orders',
    detail: 'No candidate engine, no paper entries, no live order path.',
  },
  {
    title: 'Next Sprint',
    value: 'Sprint 2',
    detail: 'Scoring and portfolio risk gates become fully operational.',
  },
];

const endpoints = [
  '/api/autopilot/health',
  '/api/autopilot/status',
  '/api/autopilot/state',
  '/api/autopilot/config',
  '/api/autopilot/paper-account',
  '/api/autopilot/decisions',
  '/api/autopilot/telemetry',
];

export default function AutopilotPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">TradeEdge</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white md:text-4xl">Autopilot</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Paper-mode autonomous portfolio manager framework. Sprint 1B exposes the dashboard shell,
              scoring utilities, dry-run endpoints, telemetry scaffolding, and run locking. Trading execution
              remains intentionally disabled.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Back to TradeEdge
          </Link>
        </div>

        <div className="mb-8">
          <KillSwitchControl />
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/20">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{card.title}</p>
              <p className="mt-2 text-2xl font-bold text-white">{card.value}</p>
              <p className="mt-3 text-sm leading-6 text-slate-300">{card.detail}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold text-white">Sprint 1B Framework Status</h2>
            <div className="mt-5 space-y-3 text-sm text-slate-300">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                <p>Decision Confidence framework is available under <code className="text-cyan-300">lib/autopilot/scoring</code>.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                <p>Opportunity Score framework is available but is not yet connected to candidate discovery.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                <p>Run locking is Redis-backed and prevents overlapping framework dry runs.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-yellow-400" />
                <p>Candidate scanning, paper fills, rolling, closing, and all trading logic remain disabled until later sprints.</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold text-white">Framework Endpoints</h2>
            <p className="mt-2 text-sm text-slate-400">These can be tested once network access allows preview or local requests.</p>
            <div className="mt-5 space-y-2">
              {endpoints.map((endpoint) => (
                <div key={endpoint} className="rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-xs text-cyan-200">
                  {endpoint}
                </div>
              ))}
              <div className="rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-xs text-cyan-200">POST /api/autopilot/run</div>
              <div className="rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-xs text-cyan-200">GET /api/autopilot/cron</div>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6">
          <h2 className="text-lg font-semibold text-amber-100">Safety Boundary</h2>
          <p className="mt-3 text-sm leading-6 text-amber-100/80">
            This page is intentionally a shell. The manual run endpoint performs a framework dry run only: it
            acquires a lock, writes telemetry, records a no-action decision, and exits. It does not scan symbols,
            size positions, create paper trades, place live orders, or manage existing positions.
          </p>
        </section>
      </div>
    </main>
  );
}
