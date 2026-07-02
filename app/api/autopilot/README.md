# Autopilot API Routes

Sprint 1A adds safe infrastructure endpoints only.

## Routes

- `GET /api/autopilot/health` — verifies API and Redis availability.
- `GET /api/autopilot/state` — returns config, paper account, recent decisions, and audit state.
- `GET /api/autopilot/status` — returns compact status summary.
- `GET /api/autopilot/paper-account` — returns paper account state.
- `POST /api/autopilot/paper-account` — resets paper account state.
- `GET /api/autopilot/decisions` — returns decision logs.

## Safety

No Sprint 1A route places real or paper trades.
