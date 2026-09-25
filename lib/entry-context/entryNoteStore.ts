// lib/entry-context/entryNoteStore.ts
//
// Owner-scoped Redis storage for entry notes (see entryNote.ts). Same scoping and idempotency
// conventions as pendingStore.ts and store.ts.

import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import type { EntryNote, PendingEntryNote } from './entryNote';

const pendingKey = (ownerScope: string, brokerOrderId: string) => `entry-context:v1:note-pending:${encodeURIComponent(ownerScope)}:${encodeURIComponent(brokerOrderId)}`;
const pendingIndexKey = (ownerScope: string) => `entry-context:v1:note-pending:index:${encodeURIComponent(ownerScope)}`;
const noteKey = (ownerScope: string, executionId: string) => `entry-context:v1:note:${encodeURIComponent(ownerScope)}:${encodeURIComponent(executionId)}`;
const noteIndexKey = (ownerScope: string) => `entry-context:v1:note:index:${encodeURIComponent(ownerScope)}`;

function requireOwner(ownerScope: string): void {
  if (!ownerScope) throw new Error('Authenticated owner scope is required');
}

export async function savePendingEntryNote(entry: PendingEntryNote, ownerScope: string): Promise<void> {
  requireOwner(ownerScope);
  await withAutopilotRedis(async redis => {
    await redis.set(pendingKey(ownerScope, entry.brokerOrderId), JSON.stringify(entry), 'NX');
    await redis.sadd(pendingIndexKey(ownerScope), entry.brokerOrderId);
  });
}

export async function readPendingEntryNotes(ownerScope: string): Promise<PendingEntryNote[]> {
  requireOwner(ownerScope);
  return withAutopilotRedis(async redis => {
    const ids = await redis.smembers(pendingIndexKey(ownerScope));
    const raws = await Promise.all(ids.map(id => redis.get(pendingKey(ownerScope, id))));
    return raws.flatMap(raw => raw == null ? [] : [JSON.parse(raw) as PendingEntryNote]);
  });
}

export async function readPendingEntryNote(ownerScope: string, brokerOrderId: string): Promise<PendingEntryNote | null> {
  requireOwner(ownerScope);
  return withAutopilotRedis(async redis => {
    const raw = await redis.get(pendingKey(ownerScope, brokerOrderId));
    return raw == null ? null : JSON.parse(raw) as PendingEntryNote;
  });
}

/** Idempotent: a note already saved for the same fill is returned unchanged. */
export async function saveEntryNote(note: EntryNote, ownerScope: string): Promise<{ note: EntryNote; created: boolean }> {
  requireOwner(ownerScope);
  return withAutopilotRedis(async redis => {
    const key = noteKey(ownerScope, note.executionId);
    const created = await redis.set(key, JSON.stringify(note), 'NX');
    if (created === 'OK') {
      await redis.sadd(noteIndexKey(ownerScope), key);
      return { note, created: true };
    }
    const existing = await redis.get(key);
    return { note: existing == null ? note : JSON.parse(existing) as EntryNote, created: false };
  });
}

export async function readEntryNotes(ownerScope: string): Promise<EntryNote[]> {
  requireOwner(ownerScope);
  return withAutopilotRedis(async redis => {
    const keys = await redis.smembers(noteIndexKey(ownerScope));
    const raws = await Promise.all(keys.map(key => redis.get(key)));
    return raws.flatMap(raw => {
      if (raw == null) return [];
      try { return [JSON.parse(raw) as EntryNote]; } catch { return []; }
    });
  });
}
