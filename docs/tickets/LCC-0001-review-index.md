# LCC-0001 — Review Index

## Product and requirements

- [Epic](./LCC-0001-equity-aware-leaps-covered-call-pmcc-epic.md)
- [Execution sequence](./LCC-0001-execution-sequence.md)

## Implementation tickets

1. [Unified Portfolio Snapshot and Equity Holdings](./LCC-0001A-unified-portfolio-snapshot-equity-holdings.md)
2. [Coverage Allocations and Strategy Composition](./LCC-0001B-coverage-allocations-strategy-composition.md)
3. [Position Entry and Management Workflows](./LCC-0001C-position-entry-management-workflows.md)
4. [Lifecycle, Reconciliation, and Migration](./LCC-0001D-lifecycle-reconciliation-migration.md)
5. [Scanner Reframing](./LCC-0001E-scanner-reframing.md)

## Approved interactive mockups

- [TradeEdge integrated LEAPS, Covered Call, and PMCC flow](./mockups/tradeedge-integrated-leaps-flow.html)
- [TradeEdge equity-aware Portfolio](./mockups/tradeedge-equity-portfolio-revision.html)

## Review disposition

- **Alan:** financial terminology, PMCC mechanics, basis treatment, assignment, and scanner transparency approved.
- **Ian:** product stages, navigation, capacity-aware actions, and Portfolio ownership approved.
- **Paul:** consolidated requirements and equity addendum approved.
- **Quinn:** invariants, state transitions, reconciliation, acceptance framework, and release gates approved.
- **Diane:** integrated happy path, lifecycle exceptions, and equity-aware Portfolio mockups complete.
- **Dane:** technical specification and implementation breakdown may begin in ticket order.

## Recommended review order

1. Epic and terminology.
2. Execution sequence and gates.
3. LCC-0001A and equity mockup.
4. LCC-0001B and mixed-symbol grouping.
5. LCC-0001C and integrated lifecycle mockup.
6. LCC-0001D exception states and migration.
7. LCC-0001E scanner integration and cutover.
