// WHY THIS FILE IS CANNED
// ---------------------------------------------------------------------------
// Simulated mode exists to teach kaafil-js's CONTRACT — the shape of a
// request, the shape of a response, and which inputs trigger which
// documented refusal. It must never teach HOW the Kaafil engine actually
// DECIDES an outcome: a seat-grid synthesiser, an auto-assign solver, a
// fingerprint of a solved plan. Those are the engine's own internal
// decision logic, this is a public examples repository, and re-deriving
// that logic here would both (a) publish proprietary behaviour nobody asked
// us to publish, and (b) silently drift from the real engine the moment it
// changes — a demo that quietly disagrees with production is worse than a
// demo that says nothing at all.
//
// So every value exported below is pre-baked: a fixed template or a canned
// string, never a formula that reconstructs what the engine would have
// computed from the caller's own inputs. A `run()` in `../specs/*.ts` still
// validates the couple of inputs that drive a DOCUMENTED refusal (a field
// the schema forbids, a business-rule violation whose code and shape are
// public in the vendored OpenAPI contract, a stale version) — that
// validation IS the observable contract, and it stays. What must not
// reappear behind it is a second, private re-implementation of the
// engine's own reasoning.
//
// This file only concerns the SIMULATED (`run()`) path — see each spec
// file's own header for the (unrelated) live-wiring story.

/** A single static 15-row x 4-across seat grid. `seating.veh` slices this
 * (never re-derives it from the requested capacity/layout) when a FLIGHT is
 * asked for a seat layout. The real engine's grid-synthesis rules for
 * TWO_TWO vs THREE_TWO are not reproduced here — this is one fixed
 * template, long enough to cover every capacity the screen's own
 * `capacity` field can ask for once clamped. */
export const SEAT_GRID_TEMPLATE: readonly string[] = [
  '1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D', '3A', '3B', '3C', '3D', '4A', '4B', '4C', '4D',
  '5A', '5B', '5C', '5D', '6A', '6B', '6C', '6D', '7A', '7B', '7C', '7D', '8A', '8B', '8C', '8D',
  '9A', '9B', '9C', '9D', '10A', '10B', '10C', '10D', '11A', '11B', '11C', '11D', '12A', '12B', '12C', '12D',
  '13A', '13B', '13C', '13D', '14A', '14B', '14C', '14D', '15A', '15B', '15C', '15D',
];

/** `seating.auto` and `rooming.auto` both used to fingerprint a dry-run plan
 * by hashing together the seat/bed labels the (locally re-implemented) fill
 * order actually produced — a fingerprint built from a real solved
 * arrangement is exactly the kind of value that can leak how a solve came
 * out. Both screens now report a canned fingerprint shape naming only the
 * plan's SIZE — enough to demonstrate the documented claim ("dryRun and
 * apply return byte-identical output") without encoding what the plan
 * actually contains. */
export function cannedPlanFingerprint(prefix: string, planLength: number): string {
  return prefix + '_demo_' + planLength;
}

/** The canned reasons `seating.auto`/`rooming.auto`'s per-rule report can
 * carry when a named rule has nothing to do. Every rule named in
 * `strategyOrder` still gets its own entry — that total accounting (never
 * omitting a rule) IS the documented contract, see each screen's own note —
 * only the STRING is canned rather than composed from a live judgment about
 * what a rule like `medicalFirst` or `gender` specifically decided. */
export const AUTO_ASSIGN_REASONS = {
  noSeatMap: 'no_seat_map',
  nothingToPlace: 'nothing_to_place',
} as const;
