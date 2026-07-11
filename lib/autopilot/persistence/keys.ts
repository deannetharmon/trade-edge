// lib/autopilot/persistence/keys.ts

export function autopilotConfigKey(userId: string): string {
  return `autopilot:config:${userId}`;
}

export function autopilotConfigAuditKey(userId: string): string {
  return `autopilot:config-audit:${userId}`;
}

export function paperAccountKey(userId: string): string {
  return `autopilot:paper-account:${userId}`;
}

export function decisionLogKey(userId: string): string {
  return `autopilot:decision-log:${userId}`;
}

export function runLockKey(userId: string): string {
  return `autopilot:run-lock:${userId}`;
}

export function auditEventsKey(userId: string): string {
  return `autopilot:audit-events:${userId}`;
}
