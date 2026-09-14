import React from 'react';
import { OptionsTelemetryCard } from '@/components/dashboard/OptionsTelemetryCard';
import { mockTelemetryData } from '@/lib/mocks/mockTelemetryData';

export default function TelemetrySandboxPage() {
  return (
    <div className="min-h-screen bg-slate-900 p-8 space-y-6">
      <h1 className="text-xl font-bold text-slate-100 font-mono">
        TradeEdge Telemetry Sandbox
      </h1>

      <div className="flex flex-wrap gap-6 items-start">
        {Object.entries(mockTelemetryData).map(([key, item]) => (
          <div key={key} className="space-y-2">
            <span className="text-xs font-mono text-slate-400 capitalize">
              {key}
            </span>
            <OptionsTelemetryCard {...item} />
          </div>
        ))}
      </div>
    </div>
  );
}
