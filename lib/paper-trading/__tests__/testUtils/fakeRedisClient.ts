// lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts
//
// PT-0001 test helper: a minimal in-memory stand-in for the small subset of
// ioredis used anywhere under lib/paper-trading (get/set with EX/NX,
// del, lpush/ltrim/lrange). Not a general Redis emulator -- only implements
// what withAutopilotRedis callers in this codebase actually call.

export class FakeRedisClient {
  private store = new Map<string, string>();
  private lists = new Map<string, string[]>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    const isNX = args.includes('NX');
    if (isNX && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  async lpush(key: string, value: string): Promise<number> {
    const arr = this.lists.get(key) ?? [];
    arr.unshift(value);
    this.lists.set(key, arr);
    return arr.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const arr = this.lists.get(key) ?? [];
    this.lists.set(key, arr.slice(start, stop === -1 ? undefined : stop + 1));
    return 'OK';
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const arr = this.lists.get(key) ?? [];
    return arr.slice(start, stop === -1 ? undefined : stop + 1);
  }

  disconnect(): void {}
}
