// lib/pmcc/pmccOrderBuilder.ts

export function buildPmccDiagonalOrder(
  accountNumber: string,
  underlying: string,
  longSymbol: string,
  shortSymbol: string,
  netDebit: number
) {
  const instrumentType = ['SPX', 'NDX', 'RUT', 'VIX'].includes(underlying.toUpperCase().trim()) 
    ? 'Index Option' 
    : 'Equity Option';

  return {
    accountNumber,
    'order-type': 'Limit',
    'time-in-force': 'GTC',
    price: netDebit.toFixed(2),
    'price-effect': 'Debit',
    legs: [
      {
        symbol: longSymbol,
        quantity: 1,
        action: 'Buy to Open',
        'instrument-type': instrumentType,
      },
      {
        symbol: shortSymbol,
        quantity: 1,
        action: 'Sell to Open',
        'instrument-type': instrumentType,
      },
    ],
  };
}
