import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import Redis from 'ioredis';
import { authOptions } from '@/lib/auth';

const POSITION_NOTE_MAX_LENGTH = 25;
type NoteStore = Record<string, string>;
const redis = new Redis(process.env.REDIS_URL!);
const redisKey = (userId: string) => `position-notes:${userId}`;
const noteKey = (accountNumber: string, positionKey: string) => `${encodeURIComponent(accountNumber)}::${encodeURIComponent(positionKey)}`;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const raw = await redis.get(redisKey(userId));
    return NextResponse.json({ notes: raw ? JSON.parse(raw) : {} });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load notes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  try {
    const body = await req.json();
    const accountNumber = typeof body?.accountNumber === 'string' ? body.accountNumber.trim() : '';
    const positionKey = typeof body?.positionKey === 'string' ? body.positionKey.trim() : '';
    const note = typeof body?.note === 'string' ? body.note : null;
    if (!accountNumber || !positionKey || note == null) return NextResponse.json({ error: 'Account, position, and note are required' }, { status: 400 });
    if (note.length > POSITION_NOTE_MAX_LENGTH) return NextResponse.json({ error: `Notes are limited to ${POSITION_NOTE_MAX_LENGTH} characters` }, { status: 400 });
    const raw = await redis.get(redisKey(userId));
    const store: NoteStore = raw ? JSON.parse(raw) : {};
    const key = noteKey(accountNumber, positionKey);
    if (note.length === 0) delete store[key]; else store[key] = note;
    await redis.set(redisKey(userId), JSON.stringify(store));
    return NextResponse.json({ ok: true, key, note });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save note' }, { status: 500 });
  }
}
