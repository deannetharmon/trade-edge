# LONG-OPTION-PATH-0001 -- strike distance vs expiration breakeven on bought options

User story (Dean): a trader holding a long-dated call must not mistake "OTM" for a protective buffer, or assume reaching the
strike makes the trade profitable. NFLX Sep-17-2027 $70 call bought at $20.85, NFLX $63.42.

## Built
- Pure `buildLongOptionPath` (`model/longOptionPath.ts`): single bought call or put only. Breakeven = strike +/- premium paid.
  Distance to strike and to breakeven, intrinsic and extrinsic per share, and the plain-language status. Null when anything is
  missing; no mark means no extrinsic claim.
- Card chips for bought options: `10.4% below strike` (was `OTM 10.4%`) and `Breakeven $90.85`. Short options unchanged.
- Show detail: `LongOptionPathPanel` -- status sentence, price path (stock, strike, breakeven in price order with "$6.58 to go",
  "$27.43 to go"), `Intrinsic value (locked in) $0.00`, `Extrinsic value (future possibility) $7.60`, and the line "Profit at
  expiration begins above strike + premium paid ($20.85)".
- Status for NFLX: "NFLX is below your strike, so this call has no intrinsic value today. Its current value is entirely time and
  volatility value. At expiration, NFLX must be above $90.85 to recover your original cost." (tested verbatim)

## Decisions
- The face of the card stays light (Dean's few-words rule): two chips. The full path and sentence live in Show detail.
- Puts mirror the call (breakeven below the strike; "above/below" swapped).
- Applies to every bought single option, not only LEAPs: the confusion is the same at any expiry.
