// Replace the sequential `for (const symbol of underlyingSymbols)` loop:

const chainMap = await fetchOptionChainsConcurrently(underlyingSymbols, 3, 150);

for (const symbol of underlyingSymbols) {
  const rawChain = chainMap.get(symbol) || [];
  if (rawChain.length === 0) continue;
  
  // Proceed with strategy criteria evaluation and scoring...
}
