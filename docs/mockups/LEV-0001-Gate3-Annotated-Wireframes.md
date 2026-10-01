# LEV-0001 Gate 3 — Annotated Wireframes

These are interaction/layout contracts, not visual styling mandates.

## Scanner — desktop

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Symbol / Instrument │ Opportunity │ Capital │ Initial Eff. Exposure │ Risk / Rank    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ NVDU [2× LONG]      │ NVDA Bull   │ $8,000  │ ~$16,000              │ 84 · Eligible  │
│ underlying: NVDA    │             │          │                       │                │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ NVDA [STOCK]        │ NVDA Bull   │ $16,000 │ $16,000               │ 82 · Eligible  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ XYZ [TYPE UNKNOWN]  │ —           │ $8,000  │ Unavailable           │ NOT COMPARABLY │
│ Normalization incomplete                                            │ RANKED          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Annotation:
1. badge and economic underlying are adjacent to identity;
2. effective exposure is not substituted for capital;
3. incomplete normalization removes authoritative comparable rank;
4. a hard failure uses FAIL status, not a lower-score visual treatment.

## Trade detail

```
┌ Leveraged Exposure ──────────────────────────────┐
│ NVDU · 2× Long · Daily Reset · Underlying NVDA │
│                                                  │
│ Capital required          $8,000                 │
│ Initial effective exp.   ~$16,000                │
│ Portfolio capital           8.0%                 │
│ Effective exposure         16.0%                 │
│                                                  │
│ Underlying stress → estimated position P/L       │
│ -20  -$3,200   -10  -$1,600   +10  +$1,600      │
│                                                  │
│ Approximation — simple multiplier stress does    │
│ not model multi-day reset/path effects.          │
│ Normalization Complete · lev-risk-v1             │
└──────────────────────────────────────────────────┘
```

## Positions roll-up

```
NVDA EXPOSURE GROUP
Gross Bull  $100k   Gross Bear $80k   Net +$20k   Capital $130k
▼ 3 positions
   NVDA   STOCK       +$40k
   NVDU   2× LONG     +$60k
   NVDD   1× INVERSE  -$80k
```

Never collapse this to “NVDA exposure = +$20k” because that hides $180k gross directional activity.

## Opportunity → Expression

```
NVDA — BULLISH                         Underlying Opportunity 86
────────────────────────────────────────────────────────────────────
Expression       Expr Score   Capital   POP    -10% Stress   Status
Bull Put Spread      88        $2.5k    74%       ...        Eligible
NVDU [2× LONG]       84        $8.0k     —       $1.6k       Eligible
CSP                   81       $17.0k    78%       ...        Eligible
LEAPS                 79        $6.2k     —        ...        Eligible
────────────────────────────────────────────────────────────────────
FAIL / incomplete expressions appear below eligible expressions with
their explicit reason and are not assigned a misleading comparable rank.
```

## Narrow layout

```
NVDU [2× LONG]
NVDA · Bullish
Capital                 $8,000
Initial effective exp. ~$16,000
-10% stress             -$1,600
Risk                     Within policy
Expression score         84
```

Identity and risk status remain visible without hover/tooltips.
