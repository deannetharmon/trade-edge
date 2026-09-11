import { useState } from 'react';
import { ScreenerParams, ScreenerApiResponse, CandidateResult } from '@/types/screener';

export function useScreener<T>(strategy: string) {
  const [data, setData] = useState<CandidateResult<T>[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (symbols: string[], config?: Partial<ScreenerParams>) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/screener/${strategy}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, config }),
      });

      const result: ScreenerApiResponse<T> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to execute screener search');
      }

      setData(result.data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  return { runSearch, data, loading, error };
}
