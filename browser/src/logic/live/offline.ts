/**
 * The offline engine, for Connected mode — one per open manager session.
 *
 * `client.openOffline({...})` (`kaafil-js@0.1.0-beta.3`) assembles the durable
 * snapshot, the write-ahead outbox, the FIFO drainer, the reconciler and the
 * batched transport on top of an already-open session. What the SDK
 * deliberately does NOT choose for you is the storage adapter — that is
 * platform-specific, and this file is where this playground makes that choice.
 *
 * ── WHY IndexedDB AND NOT THE IN-MEMORY ADAPTER ─────────────────────────────
 * `kaafil-js` ships both (`createIndexedDbStorageAdapter`,
 * `createInMemoryStorageAdapter`). This file uses the IndexedDB one and does
 * NOT silently fall back to memory when it is unavailable — because the whole
 * claim the outbox screen makes is DURABILITY. An in-memory queue that lost
 * every write on reload while the UI kept saying "queued" would be exactly the
 * half-durable store the SDK's own adapter module refuses to ship, restaged
 * here in the demo. `createIndexedDbStorageAdapter` fails at OPEN with
 * `KaafilIndexedDbUnavailableError`, and that error is allowed to propagate to
 * the response panel, named, rather than being caught into a working-looking
 * memory store.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * The scope is the session's own `managerRef`. The adapter embeds it in the
 * database name, so two managers on one browser profile never share a queue —
 * and a queue does not survive into a different credential's session, which is
 * the one way a durable local store can leak data across a login.
 *
 * ── THE NEVER-FAKE INVARIANT ────────────────────────────────────────────────
 * Nothing here manufactures a drain result, a queue depth or a pull outcome.
 * Every number the offline screens render comes from the engine's own
 * `DrainReport` / `OutboxCounts` / `PullTripResult`.
 */

import {
  createIndexedDbStorageAdapter,
  type KaafilStorageAdapter,
} from 'kaafil-js/client';
import { currentSession, sdkClient } from './transport';
import { TransportError } from './transport';

/** The engine type, taken from the client's own return type rather than
 * re-declared here — this file must not drift from what `openOffline` gives
 * back. */
type OfflineEngine = ReturnType<ReturnType<typeof sdkClient>['openOffline']>;

interface Held {
  readonly scope: string;
  readonly engine: OfflineEngine;
  readonly storage: KaafilStorageAdapter;
}

let _held: Held | null = null;

function sessionRequired(): TransportError {
  return new TransportError({
    name: 'SessionRequiredError',
    code: null,
    status: null,
    message:
      'The offline engine needs an open manager session and none is open yet. Mint one first ' +
      '(the session screen\'s "Mint session" button) — the engine is scoped to a credential, ' +
      'so there is no correct scope to build it under before one exists.',
    details: null,
    retryable: 'no',
  });
}

/** The prefix this playground passes to the adapter explicitly, rather than
 * leaning on its default. It is passed on EVERY open below and used to build
 * the name `resetOfflineEngine` deletes, so the name that is dropped and the
 * name that was opened cannot drift apart — which they silently would if this
 * restated the SDK's internal default instead of setting it. */
const DATABASE_PREFIX = 'kaafil-playground';

function databaseNameFor(scope: string): string {
  return `${DATABASE_PREFIX}:${scope}`;
}

/**
 * The engine for the currently-open manager session, built once and reused.
 * Rebuilt from scratch if the session changed underneath it (a different
 * `managerRef` is a different scope, and reusing the old engine would attach
 * one credential's queue to another's).
 *
 * `engine.open()` is awaited here rather than left to the caller: it is what
 * loads the persisted outbox and snapshot back off disk and returns any op a
 * reload left `inflight` to `pending`. A caller that skipped it would get an
 * engine that silently reported an empty queue over a full store.
 */
export async function offlineEngineFor(): Promise<OfflineEngine> {
  const session = currentSession();
  if (!session) throw sessionRequired();

  const scope = session.managerRef;
  if (_held && _held.scope === scope) return _held.engine;
  if (_held) closeHeld();

  // Deliberately un-caught: `KaafilIndexedDbUnavailableError` must reach the
  // response panel by name. See this file's header.
  const storage = await createIndexedDbStorageAdapter({ scope, databasePrefix: DATABASE_PREFIX });
  const engine = sdkClient().openOffline({ storage, scope });
  await engine.open();
  _held = { scope, engine, storage };
  return engine;
}

function closeHeld(): void {
  if (!_held) return;
  try {
    _held.engine.close();
  } catch {
    // Already closed. Teardown is the one operation that must not be able to
    // fail loudly — there is nothing a caller could do differently.
  }
  _held = null;
}

/**
 * Full local teardown: closes the engine and DELETES its IndexedDB database.
 * Returns the database name that was dropped, so the screen reports the real
 * one rather than restating the convention.
 *
 * This exists because durability is the point. A reload does not clear the
 * queue (that is the feature), so a demo needs an explicit reset — and a
 * "reset" that only dropped the in-memory handle while leaving the store on
 * disk would be a lie the very next `offlineEngineFor()` would expose.
 */
export async function resetOfflineEngine(): Promise<string> {
  const session = currentSession();
  const scope = _held?.scope ?? session?.managerRef;
  if (!scope) throw sessionRequired();

  closeHeld();
  const name = databaseNameFor(scope);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Could not delete ${name}.`));
    // `onblocked` fires when another tab still holds the database open. That
    // is a real, reportable state — not something to resolve through, because
    // resolving would report a deletion that has not happened.
    request.onblocked = () =>
      reject(
        new TransportError({
          name: 'TransportError',
          code: 'INDEXEDDB_DELETE_BLOCKED',
          status: null,
          message:
            `Another tab still has ${name} open, so it was NOT deleted. Close the other ` +
            'playground tab and run this again. (Reported rather than resolved through: a ' +
            'reset that says it cleared a store it did not clear is worse than a failure.)',
          details: { database: name },
          retryable: 'no',
        }),
      );
  });
  return name;
}
