// The REGISTRY-CONSISTENCY INVARIANT.
//
// This repo's screens are assembled from five separate records that must agree
// with one another, and nothing in the type system makes them:
//
//   `logic/methods.ts`   METHODS[mod] -> the cards, each [id, label, lane, state]
//   `logic/core.ts`      specs[`${mod}.${id}`] -> the behaviour behind a card
//   `logic/nav.ts`       GROUPS -> the sidebar item that reaches the screen
//   `logic/titles.ts`    TITLES[mod] -> the screen's own heading
//   `logic/core.ts`      kickers[mod] -> the nav-group label above that heading
//
// Written after a consolidation pass found seven complete screens (agencies,
// agencyAdmins, travellers, comms, bookings, feedbackNps, test) that had a
// METHODS block, a spec file and a sim fixture, but were never spread into
// `core.ts`'s `specs` and never added to `nav.ts`/`titles.ts` — so every one of
// their cards answered `exec()`'s `NotWiredYet` and no sidebar item reached
// them at all. Each of those is a silent, type-clean omission. This test makes
// the next one loud.
//
// It also pins R4 (`CLAUDE.md`): exactly three badge tones, two lanes, and the
// `state === 'sdk'` <-> `spec.live` equivalence that is what 'sdk' MEANS —
// "a shipped entry point satisfies its scheme", which in this codebase is
// observable as "this spec has a real `live()`". A card badged 'sdk' with no
// `live()` renders a StubCard while claiming to run for real; a card badged
// 'plan'/'console' WITH a `live()` claims a boundary it does not have.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlaygroundLogic } from '../logic/core.js';
import { METHODS } from '../logic/methods.js';
import { GROUPS } from '../logic/nav.js';
import { TITLES } from '../logic/titles.js';

const logic = new PlaygroundLogic({}) as any;
const NON_METHOD_SCREENS = new Set(['guide-run', 'guide-map', 'guide-trouble', 'tour', 'notbuilt']);
const navIds = new Set(GROUPS.flatMap((g) => g.items.map((i: { id: string }) => i.id)));

test('every screen in METHODS is reachable: a nav item, a title, and a kicker', () => {
  for (const mod of Object.keys(METHODS)) {
    assert.ok(navIds.has(mod), `nav.ts has no sidebar item for screen "${mod}" — it is unreachable in the UI`);
    assert.ok(TITLES[mod], `titles.ts has no title for screen "${mod}"`);
    assert.ok(logic.kickers[mod], `core.ts's kickers has no nav-group label for screen "${mod}"`);
  }
});

test('every nav item that is not a guide has a METHODS block', () => {
  for (const id of navIds) {
    if (NON_METHOD_SCREENS.has(id)) continue;
    assert.ok(METHODS[id], `nav.ts offers "${id}" but methods.ts has no block for it`);
  }
});

test('every METHODS card has a spec, and every spec has a card', () => {
  const keys = new Set<string>();
  for (const [mod, list] of Object.entries(METHODS)) {
    for (const [id] of list) {
      const key = `${mod}.${id}`;
      keys.add(key);
      assert.ok(logic.specs[key], `no spec wired for "${key}" — exec() will answer NotWiredYet. Is its spec file spread into core.ts?`);
    }
  }
  for (const key of Object.keys(logic.specs)) {
    assert.ok(keys.has(key), `orphan spec "${key}" — no row in methods.ts, so no card ever reaches it`);
  }
});

test('R4: exactly two lanes, exactly three badge tones, and no state/live() disagreement', () => {
  for (const [mod, list] of Object.entries(METHODS)) {
    for (const [id, , lane, state] of list) {
      const key = `${mod}.${id}`;
      assert.ok(lane === 'B' || lane === 'D', `${key}: lane must be 'B' or 'D', got "${lane}"`);
      assert.ok(['sdk', 'plan', 'console'].includes(state), `${key}: state must be sdk|plan|console (the 'raw' tone is gone — see methods.ts), got "${state}"`);
      const spec = logic.specs[key];
      if (state === 'sdk') {
        assert.ok(spec.live, `${key} is badged 'sdk' but its spec has no live() — it would render a StubCard while claiming to run for real`);
      } else {
        assert.ok(!spec.live, `${key} is badged '${state}' but its spec HAS a live() — a boundary it does not actually have`);
      }
      if (spec.lane) assert.equal(spec.lane, lane, `${key}: methods.ts says lane ${lane}, its spec says ${spec.lane}`);
    }
  }
});

test('R3: every card answers in Simulated mode without anything running', () => {
  for (const [mod, list] of Object.entries(METHODS)) {
    for (const [id] of list) {
      assert.ok(logic.specs[`${mod}.${id}`].run, `${mod}.${id} has no run() — Simulated mode would have nothing to answer with`);
    }
  }
});
