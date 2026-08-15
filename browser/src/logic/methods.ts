// Ported verbatim from `.design/logic.js` lines 9-121 (the `methods = {...}`
// class field on `Component`), re-badged against GAPS.md §5 (the per-operation
// audit) to carry four states instead of the design's original three.
//
// lane: B = runs on your CRM backend (API key) · D = runs on this device (manager session)
//
// state — four tones, GAPS.md §5, none of them interchangeable:
//   'sdk'      a typed kaafil-js method exists AND a shipped entry point satisfies its scheme —
//              live via the SDK today.
//   'raw'      the engine endpoint is live; no SDK client (KaafilClient wires only vendors+journey)
//              can reach it — live via on-ground/client.ts with a manager bearer. An SDK gap, NOT a
//              product gap: these calls run for real, same as 'sdk'.
//   'plan'     no endpoint exists yet — "coming soon". Optional 5th tuple element is the phase number
//              from implementation-plan/README.md when GAPS.md cites one.
//   'console'  the operation is consoleAuth-only by deliberate design (boundary B1/B3) — no API key
//              or manager credential will ever satisfy its scheme. Never "coming soon".
//
// Tuple shape: [id, label, lane, state, phase?]
export const METHODS: Record<string, [string, string, string, string, number?][]> = {
  session: [
    ['mint', 'auth.mintManagerToken', 'B', 'sdk'],
    ['open', 'session.open', 'D', 'sdk'],
    ['rotate', 'session rotation', 'D', 'sdk'],
    ['probe', 'read after close', 'D', 'sdk'],
    ['share', 'shareTokens.create', 'B', 'sdk']
  ],
  trips: [
    ['upsert', 'trips.upsert', 'B', 'sdk'],
    ['manifest', 'travellers.pushManifest', 'B', 'sdk'],
    ['assign', 'managers.assign', 'B', 'sdk'],
    ['get', 'trips.get', 'B', 'sdk']
  ],
  journey: [
    ['get', 'journey.get', 'B', 'sdk'],
    ['wait', 'waitUntilReady', 'B', 'sdk'],
    ['caps', 'journey.capabilities', 'B', 'sdk'],
    ['trig', 'triggers.list', 'B', 'sdk']
  ],
  itinerary: [
    ['read', 'itinerary.read', 'D', 'raw'],
    ['add', 'items.add', 'D', 'raw'],
    ['patch', 'items.patch', 'D', 'raw'],
    ['reorder', 'items.reorder', 'D', 'raw'],
    ['remove', 'items.remove', 'D', 'raw'],
    ['log', 'changeLog.list', 'D', 'raw'],
    ['delta', '?since= delta', 'D', 'raw']
  ],
  rooming: [
    ['read', 'rooming.read', 'D', 'raw'],
    ['room', 'rooms.create', 'D', 'raw'],
    ['assign', 'rooming.assign', 'D', 'raw'],
    ['auto', 'auto-assign', 'D', 'raw']
  ],
  seating: [
    ['read', 'seating.read', 'D', 'raw'],
    ['veh', 'vehicles.create', 'D', 'raw'],
    ['assign', 'seating.assign', 'D', 'raw'],
    ['auto', 'auto-assign', 'D', 'raw']
  ],
  pickups: [
    ['list', 'pickups.list', 'D', 'raw'],
    ['assign', 'pickups.assign', 'D', 'raw'],
    ['board', 'pickups.board', 'D', 'raw'],
    ['close', 'pickups.close', 'D', 'raw'],
    ['reopen', 'pickups.reopen', 'D', 'raw']
  ],
  treks: [
    ['board', 'treks.board', 'D', 'raw'],
    ['postpone', 'treks.postpone', 'D', 'raw'],
    ['walkin', 'walkIns.create', 'D', 'raw']
  ],
  checklists: [
    ['read', 'checklists.read', 'D', 'raw'],
    ['add', 'items.add', 'D', 'raw'],
    ['toggle', 'items.toggle', 'D', 'raw'],
    ['remove', 'items.remove', 'D', 'raw'],
    ['tpl', 'templates.list', 'B', 'sdk'],
    ['pull', 'templates.pull', 'B', 'sdk']
  ],
  webhooks: [
    ['events', 'events.list', 'B', 'sdk'],
    ['deliv', 'deliveries.list', 'B', 'sdk'],
    ['burst', 'coalescing burst', 'D', 'raw'],
    ['redeliver', 'deliveries.redeliver', 'B', 'sdk']
  ],
  collections: [
    ['read', 'collections.list', 'D', 'raw'],
    ['eligible', 'collections.eligible', 'D', 'raw'],
    ['record', 'collections.record', 'D', 'raw'],
    ['void', 'collections.void', 'D', 'raw']
  ],
  expenses: [
    ['read', 'expenses.list', 'D', 'raw'],
    ['log', 'expenses.log', 'D', 'raw'],
    ['claim', 'claims.submit', 'D', 'raw'],
    ['void', 'expenses.void', 'D', 'raw']
  ],
  float: [
    ['read', 'float.balance', 'D', 'raw'],
    ['issue', 'float.issue', 'D', 'raw'],
    ['return', 'float.return', 'D', 'raw'],
    ['adjust', 'float.adjust', 'D', 'raw']
  ],
  files: [
    ['request', 'files.uploadRequest', 'D', 'raw'],
    ['confirm', 'files.confirm', 'D', 'raw'],
    ['read', 'files.read', 'D', 'raw']
  ],
  vendors: [
    ['list', 'vendors.list', 'B', 'sdk']
  ],
  share: [
    ['create', 'shareTokens.create', 'B', 'sdk'],
    ['read', 'shareTokens.read', 'B', 'sdk'],
    ['revoke', 'shareTokens.revoke', 'B', 'sdk']
  ],
  entitlement: [
    // readAgencyEntitlement is consoleAuth per openapi.json — no API key will ever satisfy this
    // scheme (boundary B1). See StubCard for the 'console' tone this drives.
    ['read', 'entitlement.read', 'B', 'console'],
    ['gate', 'a flag-off refusal', 'D', 'raw']
  ],
  errors: [
    ['table', 'ERROR_CODE_TABLE', 'D', 'sdk'],
    ['local', 'refused locally', 'D', 'sdk'],
    ['retry', 'isRetryable()', 'D', 'sdk']
  ],
  offline: [
    ['cursor', 'delta cursor', 'D', 'sdk'],
    ['idem', 'idempotencyKey', 'D', 'sdk'],
    // no-offline-outbox: the queue, drain loop, backoff ladder and blob lane are unbuilt.
    // implementation-plan/README.md phase table — Phase 15, not started.
    ['outbox', 'outbox drain', 'D', 'plan', 15]
  ]
};
