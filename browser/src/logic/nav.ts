// Ported verbatim from `.design/logic.js` lines 123-156 (the `groups = [...]`
// class field on `Component`).
export const GROUPS = [
  { label: 'START HERE', items: [
    { id: 'guide-run', label: 'Run the simulator' },
    { id: 'guide-map', label: 'What the 48 steps prove' },
    { id: 'guide-trouble', label: 'Troubleshooting' },
    { id: 'tour', label: 'Guided tour', badge: 'tour' } ] },
  // PHASE 0 (this consolidation pass) — the agency-level surfaces that exist
  // BEFORE any trip does. All three are apiKeyAuth-only screens; see
  // `./methods.ts`'s `agencies`/`agencyAdmins`/`comms` blocks.
  { label: 'PHASE 0 · AGENCY SETUP', items: [
    { id: 'agencies', label: 'Agencies', cred: 'key' },
    { id: 'agencyAdmins', label: 'Agency admins', cred: 'key' },
    { id: 'comms', label: 'Messaging & comms', cred: 'key' } ] },
  { label: 'PHASE 1 · CRM SETUP', items: [
    { id: 'session', label: 'Session & auth', cred: 'both' },
    { id: 'trips', label: 'Trips', cred: 'key' },
    { id: 'travellers', label: 'Travellers & DPDP', cred: 'key' },
    { id: 'bookings', label: 'Bookings', cred: 'key' },
    { id: 'journey', label: 'Journey', cred: 'key' } ] },
  { label: "PHASE 2 · MANAGER'S DAY", items: [
    { id: 'itinerary', label: 'Itinerary', cred: 'mgr' },
    { id: 'rooming', label: 'Rooming', cred: 'mgr' } ] },
  { label: 'PHASE 3 · BOARDING DAY', items: [
    { id: 'seating', label: 'Seating', cred: 'mgr' },
    { id: 'pickups', label: 'Pickup points', cred: 'mgr' },
    { id: 'treks', label: 'Treks', cred: 'mgr' } ] },
  { label: 'PHASE 4 · MONEY ON THE GROUND', items: [
    { id: 'collections', label: 'Collections', cred: 'mgr' },
    { id: 'expenses', label: 'Expenses & claims', cred: 'mgr' },
    { id: 'float', label: 'Float', cred: 'mgr' } ] },
  { label: 'PHASE 5 · CLOSE-OUT', items: [
    { id: 'checklists', label: 'Checklists', cred: 'mgr' },
    { id: 'closeout', label: 'Closing day', cred: 'mgr' },
    { id: 'files', label: 'Files & receipts', cred: 'mgr' },
    { id: 'vendors', label: 'Vendors', cred: 'key' },
    { id: 'webhooks', label: 'Webhooks & events', cred: 'key' },
    { id: 'forms', label: 'Forms', cred: 'key' } ] },
  { label: 'PHASE 6 · TRAVELLER', items: [
    { id: 'share', label: 'Share links', cred: 'key' },
    { id: 'feedbackNps', label: 'Feedback & NPS', cred: 'key' } ] },
  { label: 'CROSS-CUTTING', items: [
    { id: 'entitlement', label: 'Plans & entitlement', cred: 'key' },
    { id: 'errors', label: 'Errors & retryability' },
    { id: 'offline', label: 'Offline & delta sync' },
    { id: 'test', label: 'Sandbox & test clock', cred: 'key' },
    { id: 'notbuilt', label: 'Not built yet' } ] }
];
