// Ported verbatim from `.design/logic.js` lines 123-156 (the `groups = [...]`
// class field on `Component`).
export const GROUPS = [
  { label: 'START HERE', items: [
    { id: 'guide-run', label: 'Run the simulator' },
    { id: 'guide-map', label: 'What the 48 steps prove' },
    { id: 'guide-trouble', label: 'Troubleshooting' },
    { id: 'tour', label: 'Guided tour', badge: 'tour' } ] },
  { label: 'PHASE 1 · CRM SETUP', items: [
    { id: 'session', label: 'Session & auth', cred: 'both' },
    { id: 'trips', label: 'Trips', cred: 'key' },
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
    { id: 'webhooks', label: 'Webhooks & events', cred: 'key' } ] },
  { label: 'PHASE 6 · TRAVELLER', items: [
    { id: 'share', label: 'Share links', cred: 'key' } ] },
  { label: 'CROSS-CUTTING', items: [
    { id: 'entitlement', label: 'Plans & entitlement', cred: 'key' },
    { id: 'errors', label: 'Errors & retryability' },
    { id: 'offline', label: 'Offline & delta sync' },
    { id: 'notbuilt', label: 'Not built yet' } ] }
];
