// lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts
//
// PT-0001 test helper: a minimal in-memory stand-in for the small subset of
// ioredis used anywhere under lib/paper-trading (get/set with EX/NX, del,
// lpush/ltrim/lrange, eval).  Not a general Redis emulator -- only
// implements what withAutopilotRedis callers in this codebase actually call.
//
// PT-0001 PO Round 2 (atomic-commit redesign):
//  - eval() now recognizes TWO distinct scripts by a leading marker comment,
//    the same way real code would only ever run one of two known scripts:
//      - "PAPER_COMMIT_V2" (persistence/commit.ts's COMMIT_SCRIPT): emulates
//        the single-EVAL accepted-mutation commit (lock-ownership check,
//        then account SET + audit LPUSH/LTRIM + optional idempotency SET,
//        all-or-nothing).
//      - the lock compare-and-delete pattern (persistence/locking.ts's
//        RELEASE_IF_OWNER_SCRIPT) -- unchanged from the prior round.
//  - failNextCommit(mode) lets a test simulate exactly the failure surface
//    persistence/commit.ts's own doc comment describes:
//      - 'before_apply': the EVAL never reaches/executes on the (simulated)
//        server -- nothing is written, then the call throws. This is what
//        commitPaperMutation must resolve to a confirmed-safe, retryable
//        COMMIT_FAILED.
//      - 'after_apply': the script runs its FULL write phase (all three
//        writes together, exactly as the real Lua script would) and THEN
//        the call throws -- simulating the response being lost on the way
//        back to the client after Redis already committed. commitPaperMutation
//        must resolve this to the original success result, not a failure,
//        and must not write anything a second time.
//      - 'partial_apply': deliberately NOT achievable by the real atomic
//        script (which either performs all of its writes or none), but
//        injectable here to drive resolveAmbiguousOutcome()'s disagreement
//        branch -- i.e. to prove the code can detect and surface a
//        genuinely inconsistent persistence state instead of silently
//        guessing.
//  - The old watch()/unwatch()/multi()/exec()/failNextExec() apparatus from
//    the WATCH/MULTI/EXEC design has been removed: persistence/commit.ts no
//    longer uses Redis transactions at all (see its module doc comment for
//    why), and nothing else in this codebase calls them.
//
// PT-0001 PO Round 4: _evalPaperCommit() now also validates the idempotency
// value/TTL arguments before any write, exactly mirroring COMMIT_SCRIPT's
// own pre-write validation, returning "INVALID_ARG" (writing nothing) for
// an empty value, a non-numeric TTL, a fractional TTL, a zero TTL, or a
// negative TTL. This fake must model the real script's validation, not
// silently accept an invalid TTL the real script would now reject.
//
// PT-0001 PO Round 5: two new single-shot failure hooks let a test inject a
// failure into resolveAmbiguousOutcome()'s OWN reconciliation reads (as
// opposed to the original EVAL call) -- this is the scenario the Product
// Owner described: the commit's EVAL acknowledgement is lost, and the
// follow-up attempt to re-read authoritative state to resolve that ambiguity
// itself fails.
//   - failNextGetForKey(key, reason?): `get()` serves multiple different
//     reconciliation/lookup reads in this codebase (the account read, the
//     idempotency-record read, checkIdempotency()'s own read, ...). The
//     commit script emulation's OWN lock-ownership check reads the internal
//     `store` map directly (never through the public `get()` method -- see
//     _evalPaperCommit() below), so it is never affected by this hook. This
//     hook is KEYED -- it only fires on a `get()` call for the exact key
//     given, leaving every other key's read unaffected.
//   - failNextLrange(reason?): `lrange()` has exactly one caller in this
//     codebase, audit.ts's getPaperAuditEvents(), so this hook is safely
//     unkeyed.
// A third CommitFailureMode, 'lock_lost', was also added: it makes the
// commit script emulation return "LOCK_LOST" unconditionally (a normal,
// non-throwing script return, exactly like the real script's confirmed
// lock-ownership check failing) regardless of the actual store state, so a
// service-level test can drive a CONFIRMED_NOT_COMMITTED lock-loss through
// openPaperPosition()/closePaperPosition()'s real call path without needing
// to interleave a real concurrent lock-stealing request.

type CommitFailureMode = 'before_apply' | 'after_apply' | 'partial_apply' | 'lock_lost';

export class FakeRedisClient {
  private store = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private forcedCommitFailure: { mode: CommitFailureMode; reason: string } | null = null;
  private forcedPlainAppendFailure: string | null = null;
  private forcedGetFailure: { key: string; reason: string; skip: number } | null = null;
  private forcedLrangeFailure: string | null = null;

  /**
   * Arms the NEXT `eval()` call that matches the PAPER_COMMIT_V2 script to
   * fail in the given way. See the module doc comment above for what each
   * mode simulates. Consumed (cleared) by that next matching call.
   */
  failNextCommit(mode: CommitFailureMode, reason = `Simulated Redis commit failure (${mode})`): void {
    this.forcedCommitFailure = { mode, reason };
  }

  /**
   * Arms the NEXT plain (non-script) `lpush()` call to throw -- i.e. the
   * next STANDALONE audit append (audit.ts's appendPaperAuditEvent(), used
   * for pre-commit rejections and observational replay/duplicate notices),
   * as opposed to a write performed INSIDE the atomic commit script's own
   * internal `_rawLpush` calls. PO Round 4: lets a test prove that a failure
   * in this specific, non-atomic append path can never convert an
   * already-confirmed commit success or replay into an apparent failure.
   */
  failNextPlainAppend(reason = 'Simulated standalone audit append failure'): void {
    this.forcedPlainAppendFailure = reason;
  }

  /**
   * Arms a future `get()` call for this exact key to throw. Keyed (see
   * module doc comment for why). `skip` lets a test target a call other than
   * the very NEXT matching one -- e.g. the same key is legitimately read
   * once early (checkIdempotency()'s initial replay check, or
   * commitPaperMutation()'s own pre-build() account read) before the
   * RECONCILIATION read this hook is meant to target happens later in the
   * same call; `skip: 1` lets that first, unrelated call through untouched
   * and fails only the next one after it. Consumed (cleared) once the
   * targeted call is reached.
   */
  failNextGetForKey(key: string, reason = `Simulated Redis GET failure for key ${key}`, skip = 0): void {
    this.forcedGetFailure = { key, reason, skip };
  }

  /**
   * Arms the NEXT `lrange()` call (any key) to throw. Single-shot, unkeyed
   * (see module doc comment for why this is safe). PO Round 5.
   */
  failNextLrange(reason = 'Simulated Redis LRANGE failure'): void {
    this.forcedLrangeFailure = reason;
  }

  async get(key: string): Promise<string | null> {
    if (this.forcedGetFailure?.key === key) {
      if (this.forcedGetFailure.skip > 0) {
        this.forcedGetFailure = { ...this.forcedGetFailure, skip: this.forcedGetFailure.skip - 1 };
      } else {
        const { reason } = this.forcedGetFailure;
        this.forcedGetFailure = null;
        throw new Error(reason);
      }
    }
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    const isNX = args.includes('NX');
    if (isNX && this.store.has(key)) return null;
    this._rawSet(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this._rawDel(key);
  }

  async lpush(key: string, value: string): Promise<number> {
    if (this.forcedPlainAppendFailure) {
      const reason = this.forcedPlainAppendFailure;
      this.forcedPlainAppendFailure = null;
      throw new Error(reason);
    }
    return this._rawLpush(key, value);
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    this._rawLtrim(key, start, stop);
    return 'OK';
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (this.forcedLrangeFailure) {
      const reason = this.forcedLrangeFailure;
      this.forcedLrangeFailure = null;
      throw new Error(reason);
    }
    const arr = this.lists.get(key) ?? [];
    return arr.slice(start, stop === -1 ? undefined : stop + 1);
  }

  /**
   * Emulates ioredis's `.eval(script, numKeys, ...keys, ...argv)` for the
   * two Lua scripts this codebase actually runs -- not a Lua interpreter.
   */
  async eval(script: string, numKeys: number, ...rest: unknown[]): Promise<unknown> {
    const keys = rest.slice(0, numKeys) as string[];
    const argv = rest.slice(numKeys) as string[];

    if (script.includes('PAPER_COMMIT_V2')) {
      return this._evalPaperCommit(keys, argv);
    }

    if (script.includes('redis.call("GET"') && script.includes('redis.call("DEL"')) {
      const [key] = keys;
      const [expected] = argv;
      const current = this.store.get(key);
      if (current !== undefined && current === expected) {
        this._rawDel(key);
        return 1;
      }
      return 0;
    }

    throw new Error('FakeRedisClient.eval: unsupported script (only PAPER_COMMIT_V2 and the lock compare-and-delete pattern are emulated)');
  }

  /**
   * Mirrors persistence/commit.ts's COMMIT_SCRIPT: check lock ownership
   * first (returns "LOCK_LOST" -- a CONFIRMED, definitive abort -- with
   * nothing written if it fails), then perform every write together. See
   * failNextCommit() above for how a test injects a failure at each stage.
   */
  private _evalPaperCommit(keys: string[], argv: string[]): string {
    const [accountKey, lockKey, auditKey, idemKey] = keys;
    const [lockId, nextAccountJson, auditEventJson, auditMaxArg, idemValue, idemTtlArg] = argv;

    const forced = this.forcedCommitFailure;
    this.forcedCommitFailure = null;

    if (forced?.mode === 'before_apply') {
      throw new Error(forced.reason);
    }

    if (forced?.mode === 'lock_lost') {
      return 'LOCK_LOST';
    }

    const currentLock = this.store.get(lockKey);
    if (currentLock !== lockId) {
      return 'LOCK_LOST';
    }

    // Mirrors COMMIT_SCRIPT's own idempotency-argument validation: every
    // argument the final `SET ... EX <ttl>` depends on must be checked
    // before any write, not silently accepted. PO Round 4 -- this fake must
    // model the real script's validation, not just its happy path.
    if (idemKey) {
      if (idemValue === '') {
        return 'INVALID_ARG';
      }
      const ttl = Number(idemTtlArg);
      if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl <= 0) {
        return 'INVALID_ARG';
      }
    }

    if (forced?.mode === 'partial_apply') {
      // Deliberately inconsistent with the real script's all-or-nothing
      // guarantee: only the account write lands. Used to test detection of
      // disagreement between the ledger, audit trail, and idempotency
      // record, not to model a real Redis outcome.
      this._rawSet(accountKey, nextAccountJson);
      throw new Error(forced.reason);
    }

    this._rawSet(accountKey, nextAccountJson);
    this._rawLpush(auditKey, auditEventJson);
    this._rawLtrim(auditKey, 0, Number(auditMaxArg));
    if (idemKey) {
      this._rawSet(idemKey, idemValue);
    }

    if (forced?.mode === 'after_apply') {
      throw new Error(forced.reason);
    }

    return 'OK';
  }

  _rawSet(key: string, value: string): void {
    this.store.set(key, value);
  }

  _rawDel(key: string): number {
    return this.store.delete(key) ? 1 : 0;
  }

  _rawLpush(key: string, value: string): number {
    const arr = this.lists.get(key) ?? [];
    arr.unshift(value);
    this.lists.set(key, arr);
    return arr.length;
  }

  _rawLtrim(key: string, start: number, stop: number): void {
    const arr = this.lists.get(key) ?? [];
    this.lists.set(key, arr.slice(start, stop === -1 ? undefined : stop + 1));
  }

  disconnect(): void {}
}
