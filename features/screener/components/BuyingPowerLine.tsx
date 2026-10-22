// features/screener/components/BuyingPowerLine.tsx
//
// OBP-LINE-0001: "Option buying power" row for order screens, placed under what the order requires. Fetches the broker's figure
// once when the order screen opens; red with the shortfall when the order needs more than is available. Informational only: the
// collateral guards that block orders are unchanged.

'use client';

import { useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/auth/tastytradeToken';
import { getCspCapitalContext } from '@/lib/scans/tastytrade-client';
import { buyingPowerStatus } from '@/lib/scans/buyingPowerStatus';

const money = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BuyingPowerLine({ required, labelClass, valueClass }: { required: number; labelClass: string; valueClass: string }) {
  const [available, setAvailable] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const capital = await getCspCapitalContext(await getAccessToken());
        if (!cancelled) setAvailable(capital.optionBuyingPower);
      } catch { if (!cancelled) setAvailable(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  const status = buyingPowerStatus(available, required);
  return (
    <div className="flex justify-between text-xs" data-testid="buying-power-line">
      <span className={labelClass}>Option buying power</span>
      <span className={status.state === 'short' ? 'text-red-400 font-semibold' : valueClass}>
        {available === undefined ? 'Loading…' : status.state === 'unknown' ? 'Not reported' : status.state === 'short' ? `${money(available as number)} · short ${money(status.shortBy)}` : money(available as number)}
      </span>
    </div>
  );
}
