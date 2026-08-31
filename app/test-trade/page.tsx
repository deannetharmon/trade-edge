// app/test-trade/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { getCustomerAccounts, placeOrder, buildBullPutSpread } from '@/lib/tastytrade';
import { persistValidatedBrokerAccountId, readPersistedBrokerAccountId, resolveBrokerAccounts } from '@/lib/tastytrade/accountSelection';

export default function TestTradePage() {
  const [token, setToken] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [status, setStatus] = useState('');
  const [isSandbox, setIsSandbox] = useState(true);

  // Auto-load token from login
  useEffect(() => {
    const savedToken = localStorage.getItem('tt_access_token');
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  const handleGetAccounts = async () => {
    if (!token) {
      alert("Please login first");
      return;
    }

    setStatus("Getting accounts...");
    try {
      const accounts = await getCustomerAccounts(token, isSandbox);
      if (isSandbox) {
        if (accounts.length === 1) {
          setAccountNumber(accounts[0].account_number);
          setStatus(`✅ Sandbox account found: ${accounts[0].account_number}`);
        } else {
          setStatus(accounts.length > 1 ? 'Sandbox account selection is not managed by the live app account control.' : 'No accounts found');
        }
        return;
      }
      const resolution = resolveBrokerAccounts(
        accounts.map((account: { account_number: string }) => ({ id: account.account_number, label: 'Broker account' })),
        readPersistedBrokerAccountId(),
      );
      if (resolution.status === 'ready' && resolution.accountId) {
        persistValidatedBrokerAccountId(resolution.accountId);
        setAccountNumber(resolution.accountId);
        setStatus(`✅ Active account found: ${resolution.accountId}`);
      } else if (resolution.status === 'selection_required') {
        setStatus('Choose the active broker account in the app account control before testing a trade.');
      } else if (resolution.status === 'selected_account_missing') {
        setStatus('The active app account is not available in this environment. Switch accounts before testing a trade.');
      } else {
        setStatus("No accounts found");
      }
    } catch (err: any) {
      setStatus("❌ Error: " + err.message);
    }
  };

  const handleTestOrder = async () => {
    if (!token || !accountNumber) {
      alert("Need token and account first");
      return;
    }

    setStatus("Creating dry-run order...");

    const orderPayload = buildBullPutSpread(
      "SPY  250516P00560000",   // short put
      "SPY  250516P00550000",   // long put
      1,
      1.25
    );

    try {
      const result = await placeOrder(accountNumber, orderPayload, token, isSandbox, true);
      setStatus(`✅ Dry-run successful!`);
      console.log(result);
    } catch (err: any) {
      setStatus("❌ Order failed: " + err.message);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Test Trading (Safe Mode)</h1>
      
      <div className="mb-4">
        <a href="/login" className="text-blue-400 underline">← Go to Login Page</a>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm mb-2">Access Token (auto-filled after login)</label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full p-3 border rounded bg-gray-800 text-white"
            placeholder="Token will appear here after login"
          />
        </div>

        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isSandbox} onChange={(e) => setIsSandbox(e.target.checked)} />
            Use Sandbox (Fake Money) - Keep ON for testing
          </label>
        </div>

        <button onClick={handleGetAccounts} className="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700">
          1. Get My Account Number
        </button>

        {accountNumber && <p className="text-green-600">Account: {accountNumber}</p>}

        <button 
          onClick={handleTestOrder} 
          disabled={!accountNumber}
          className="bg-green-600 text-white px-6 py-3 rounded hover:bg-green-700 disabled:opacity-50"
        >
          2. Test Dry-Run Bull Put Spread
        </button>

        <div className="p-4 bg-gray-900 rounded min-h-[120px] whitespace-pre-wrap text-sm">
          {status || "Status will appear here..."}
        </div>
      </div>
    </div>
  );
}
