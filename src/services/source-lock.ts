// Single-source synchronization lock backed by a PostgreSQL session-scoped
// advisory lock held on a dedicated pg.Client connection.
//
// Why a dedicated Client (not the Prisma pool):
//   - PrismaPg v7 wraps pg.Pool with `idleTimeoutMillis: 10000` (vs v6's 300s).
//   - Holding the Prisma-pool connection open across a 14-minute sync causes
//     the pool to recycle the connection after 10s of idleness, invalidating
//     any outer Prisma transaction (Prisma P2028).
//   - A dedicated single Client has no idle timeout and can be released
//     explicitly via pg_advisory_unlock + client.end().
//
// Why session-scoped pg_try_advisory_lock (not pg_try_advisory_xact_lock):
//   - Session-scoped locks survive across short Prisma transactions.
//   - They are released explicitly via pg_advisory_unlock or implicitly when
//     the underlying pg.Client disconnects (process crash or .end()).
//   - This lets the SourceSyncService.sync() body be a sequence of short
//     Prisma operations without any long-lived transaction.
//
// Per-source key: deterministic bigint hash of the JobSource enum string,
// scoped to this application (offset by a constant namespace prefix so it
// cannot collide with locks acquired by other code paths).

import pg from "pg";
import { JobSource } from "@prisma/client";

const ADVISORY_LOCK_NAMESPACE = 0x48544e5f4c4f434b; // "HTN_LOCK"

export function sourceLockKey(source: JobSource): bigint {
  let hash = 5381n;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 33n) ^ BigInt(source.charCodeAt(i));
  }
  const scoped = (hash & 0xffffffffn) ^ BigInt(ADVISORY_LOCK_NAMESPACE);
  return scoped & 0x7fffffffffffffffn;
}

export interface HeldSourceLock {
  readonly source: JobSource;
  readonly key: bigint;
  readonly connection: pg.Client;
}

/**
 * Acquire a session-scoped PostgreSQL advisory lock for the given source.
 *
 * Uses a dedicated pg.Client (not the Prisma pool) so that the lock survives
 * independently of the Prisma transaction lifecycle. The function connects
 * the client synchronously, runs pg_try_advisory_lock, and either returns a
 * HeldSourceLock or releases the connection and returns null.
 *
 * @returns HeldSourceLock on success (caller MUST call releaseSourceLock in
 *          a finally block), or null if another sync already holds the lock.
 */
export async function acquireSourceLock(
  source: JobSource,
  connectionString: string,
): Promise<HeldSourceLock | null> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const key = sourceLockKey(source);
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [key.toString()],
    );
    if (result.rows[0]?.acquired !== true) {
      await client.end();
      return null;
    }
    return { source, key, connection: client };
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }
}

/**
 * Release a previously-acquired session-scoped advisory lock and close its
 * dedicated pg.Client. Safe to call from a finally block — any error during
 * release is swallowed because the caller is already on a cleanup path.
 */
export async function releaseSourceLock(lock: HeldSourceLock): Promise<void> {
  try {
    await lock.connection.query("SELECT pg_advisory_unlock($1)", [
      lock.key.toString(),
    ]);
  } catch {
    // Best-effort release. The lock is also auto-released when the
    // connection drops, so even a hard error here leaves no permanent lock.
  } finally {
    try {
      await lock.connection.end();
    } catch {
      // already closed or never connected — nothing to do
    }
  }
}
