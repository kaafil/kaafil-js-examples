// Ported verbatim from `.design/logic.js` lines 158-183 (the `titles = {...}`
// class field on `Component`).
export const TITLES: Record<string, [string, string]> = {
  'guide-run': ['Run the Node simulator', 'Only needed for Connected mode — Simulated needs nothing running. Three processes, three jobs: our engine, your CRM backend, this tab.'],
  'guide-map': ['What the 48 steps prove', 'Every numbered step in server/simulate.ts, mapped to the screen here that shows the same claim.'],
  'guide-trouble': ['Troubleshooting', 'Symptom, cause, fix — including the three failures that look like a broken SDK and are not.'],
  tour: ['Guided tour', 'Twelve lessons in dependency order, from minting a manager session to draining an outbox.'],
  session: ['Session & auth', 'Two entry points, two credentials: kaafil-js carries the API key, kaafil-js/client never sees one.'],
  trips: ['Trips', 'Ingest a trip, push a manifest, assign a manager — the CRM side, on the partner API key.'],
  journey: ['Journey', 'The build is asynchronous; capabilities are four-axis and stay listed even when dark.'],
  itinerary: ['Itinerary', "Days that materialised themselves, server-owned sortOrder, LIVE derived on read, and a ?since= delta with a tombstone in it."],
  rooming: ['Rooming', 'A board filled from a preview that is byte-identical to its own apply, with chips drawn from the server’s glyph and tone.'],
  seating: ['Seating', 'A road vehicle that refuses a seat layout, a flight that gets one, and a seat-less assignment that is not a gap.'],
  pickups: ['Pickup points', 'One error code, two close policies: a TRIP hard-blocks, a TREK asks for confirmation.'],
  treks: ['Treks', 'A postpone that ripples into itinerary dates and the stay window while pickup times explicitly do not move.'],
  checklists: ['Checklists', 'Four reserved sections seeded inside trip-ingest’s own transaction, and a guard on status rather than version.'],
  webhooks: ['Webhooks & events', 'Three edits inside one five-second window produce exactly one event.'],
  collections: ['Collections', 'Money in, captured on the ground: paise integers, the trip’s own currency, and an overpay guard that is a hard refusal rather than a toggle.'],
  expenses: ['Expenses & claims', 'What a manager spent, and the claim a manager files on their own money — with a decision that belongs to the CRM, not the phone.'],
  float: ['Float', 'Cash handed to a manager and returned: movements that can never take a balance negative, and an adjustment that must say why.'],
  files: ['Files & receipts', 'A presigned upload, a confirm step, and a fixed wire contract: 10 MB, five content types, fifteen minutes.'],
  vendors: ['Vendors', 'The clearest dark capability in the product: real, gated, and answering 422 with details.reason “data” until rows are ingested.'],
  share: ['Share links', 'The traveller’s credential: opaque, config-scoped, self-filtering, expiry clamped by the server — never a manager session.'],
  entitlement: ['Plans & entitlement', 'Kaafil defines the flags, the CRM toggles them per agency. Mode beats flag, unconditionally.'],
  notbuilt: ['Not built yet', 'Everything the specs describe that has no endpoint to call today — named, with where it lands, so nothing here looks like a hidden feature.'],
  errors: ['Errors & retryability', 'The typed classes worth branching on, and the table that answers “can I retry this?”.'],
  offline: ['Offline & delta sync', 'Writes queue with fixed idempotency keys, drain FIFO per trip, and reconcile on the server’s own clock.']
};
