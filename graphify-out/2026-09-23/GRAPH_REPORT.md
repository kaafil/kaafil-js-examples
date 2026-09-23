# Graph Report - kaafil-js-examples  (2026-08-28)

## Corpus Check
- 98 files · ~147,582 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 552 nodes · 1252 edges · 49 communities (24 shown, 25 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `30b098e8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- core.ts
- s
- simulate.ts
- transport.ts
- package.json
- PlaygroundLogic
- server.ts
- compilerOptions
- extract-design.mjs
- specs/forms.ts
- specs/travellers.ts
- App.tsx
- registry.test.ts
- specs/test.ts
- The typed error model (KaafilValidationError etc.)
- onground-write-unreachable (CLOSED 2026-08-16)
- Kaafil SDK Playground README
- errors.ts
- Kaafil Gap Register
- Three-state badge vocabulary (sdk/plan/console)
- comms-no-production-sender (partly closed 2026-08-20)
- Why the API key lives here, and only here
- POST /sdk — why it exists, and why it is not a pattern to copy
- main.tsx
- vite.config.ts
- R3: Simulated mode needs nothing running
- R6: Manager lane goes direct tab-to-engine
- R7: kaafil-js pinned exact version
- The 'raw' badge is gone
- agency-admin-upsert-no-sdk-method (CLOSED 2026-08-20)
- feedback-nps-comms-vendor-rating-unbuilt (partly closed)
- browser/.design/ is generated output
- CLAUDE.md Working Brief
- R8: packageManager and .nvmrc pinned
- B2: no POST /api/v1/agencies
- B3: platformAdminAuth-only partner bootstrap
- B4: reviews and support tickets deferred (D-025)
- B5: KaafilClient holds tokens in memory only
- B6: no auth.revoke() method
- B7: no apiKeyAuth trip-listing operation
- B8: no operation reads/lists a Manager entity
- no-signature-verification-helper (sdk-ergonomics, unscheduled)
- ratelimit-visibility-reactive-only (unscheduled)
- usage-ingest-log-doc-mismatch (P1, doc gap)
- Guided tour — 16 lessons in dependency order
- The ?since= delta cursor must be the server's own clock

## God Nodes (most connected - your core abstractions)
1. `toFail()` - 74 edges
2. `s()` - 68 edges
3. `sdkCall()` - 58 edges
4. `okLive()` - 47 edges
5. `okFromSdk()` - 44 edges
6. `managerClient()` - 37 edges
7. `resolveAgencyRef()` - 26 edges
8. `unwrapSdk()` - 22 edges
9. `main()` - 20 edges
10. `PlaygroundLogic` - 17 edges

## Surprising Connections (you probably didn't know these)
- `R2: SDK entry points stay separate at module-graph level` --conceptually_related_to--> `onground-write-unreachable (CLOSED 2026-08-16)`  [INFERRED]
  CLAUDE.md → GAPS.md
- `Playground app shell (#root + main.tsx entry)` --conceptually_related_to--> `Kaafil SDK Playground README`  [INFERRED]
  browser/index.html → README.md
- `allowBuilds esbuild allowlist` --conceptually_related_to--> `Kaafil SDK Playground README`  [INFERRED]
  pnpm-workspace.yaml → README.md
- `StubCard()` --calls--> `s()`  [EXTRACTED]
  browser/src/ui/StubCard.tsx → browser/src/dc/style.ts
- `GET /entitlement/:agencyRef answers a real 501` --references--> `B1: consoleAuth-only admin operations`  [EXTRACTED]
  backend/README.md → GAPS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **API-key-stays-server-side boundary enforced across rule, implementation, and docs** — claude_md_r1_api_key_boundary, backend_readme_api_key_isolation, readme_backend_routes [EXTRACTED 1.00]
- **Simultaneous 2026-08-16 closure by kaafil-js@0.1.0-beta.3** — gaps_onground_write_unreachable, gaps_no_offline_outbox, gaps_closing_day_unbuilt [EXTRACTED 1.00]
- **Three-badge taxonomy (sdk/plan/console) shared across CLAUDE.md, README.md, GAPS.md** — claude_md_r4_badge_system, readme_badge_reading, gaps_badge_taxonomy [EXTRACTED 1.00]

## Communities (49 total, 25 thin omitted)

### Community 0 - "core.ts"
Cohesion: 0.08
Nodes (75): PlaygroundLogicProps, LiveFail, LiveOk, okFromSdk(), okLive(), toFail(), unwrapSdk(), managerClient() (+67 more)

### Community 1 - "s"
Cohesion: 0.05
Nodes (51): Code(), CodeLang, CodeProps, getHighlighter(), highlight(), highlightCache, unwrap(), useHighlighted() (+43 more)

### Community 2 - "simulate.ts"
Cohesion: 0.06
Nodes (39): assertEquals(), AssertionFailure, assertJsonEquals(), assertTrue(), BlockedRecord, BlockedStep, ItineraryItem, ItineraryRead (+31 more)

### Community 3 - "transport.ts"
Cohesion: 0.09
Nodes (38): sectionsForSubject(), closeHeld(), databaseNameFor(), Held, OfflineEngine, offlineEngineFor(), resetOfflineEngine(), sessionRequired() (+30 more)

### Community 4 - "package.json"
Cohesion: 0.04
Nodes (44): kaafil-js, comment:play, comment:pnpm, dependencies, kaafil-js, react, react-dom, shiki (+36 more)

### Community 5 - "PlaygroundLogic"
Cohesion: 0.12
Nodes (22): PlaygroundLogic, guides(), setBackendUrl(), HELPERS, seedSim(), guideVals(), TOUR, tourGo() (+14 more)

### Community 6 - "server.ts"
Cohesion: 0.15
Nodes (22): AgencyAdminSession, ALLOWLISTED_SDK_PATHS, callAllowlistedSdkPath(), handleAgencyAdminSession(), handleGetTrip(), handlePushManifest(), handleSdk(), handleSession() (+14 more)

### Community 7 - "compilerOptions"
Cohesion: 0.08
Nodes (24): backend/**/*.ts, browser/**/*.ts, browser/**/*.tsx, DOM, ES2022, node, server/**/*.ts, compilerOptions (+16 more)

### Community 8 - "extract-design.mjs"
Cohesion: 0.10
Nodes (17): fontNames, fonts, helmet, helmetEnd, helmetOpen, HERE, html, logic (+9 more)

### Community 9 - "specs/forms.ts"
Cohesion: 0.23
Nodes (15): BINDINGS_FIXTURE, FIELD_KINDS, FORM_FIXTURE, FORM_PHASES, cloneFixture(), ensureDispatch(), ensureFormResponses(), ensureForms() (+7 more)

### Community 11 - "specs/travellers.ts"
Cohesion: 0.29
Nodes (8): AGENCY_FIXTURE, AGENCY_MANAGER_DIRECTORY_FIXTURE, AGENCY_SETTINGS_FIXTURE, AGENCY_TRAVELLER_DIRECTORY_FIXTURE, dsarBundleFixture(), TRAVELLER_ERASE_CASCADE_TEMPLATE, TRIP_MANIFEST_FIXTURE, KNOWN_TRAVELLER_REFS

### Community 12 - "App.tsx"
Cohesion: 0.29
Nodes (4): App(), DCLogic, useLogic(), useLogicInstance()

### Community 13 - "registry.test.ts"
Cohesion: 0.27
Nodes (6): logic, navIds, NON_METHOD_SCREENS, METHODS, GROUPS, TITLES

### Community 14 - "specs/test.ts"
Cohesion: 0.42
Nodes (7): resolveEnvironment(), FIXTURE_REF_MAP_FIXTURE, initialTestClock(), SANDBOX_QUOTA_FIXTURE, buildRefusal(), refuseUnlessTestPlane(), testSpecs()

### Community 15 - "The typed error model (KaafilValidationError etc.)"
Cohesion: 0.29
Nodes (7): GET /entitlement/:agencyRef answers a real 501, The four routes — the real contract, R5: Errors re-serialised faithfully, B1: consoleAuth-only admin operations, The four routes the backend owns, The typed error model (KaafilValidationError etc.), Node walkthrough — pnpm simulate, 57 steps

### Community 16 - "onground-write-unreachable (CLOSED 2026-08-16)"
Cohesion: 0.40
Nodes (5): R2: SDK entry points stay separate at module-graph level, closing-day-unbuilt (CLOSED 2026-08-16, Phase 14), no-offline-outbox (CLOSED 2026-08-16, Phase 15), onground-write-unreachable (CLOSED 2026-08-16), sync-push-share-unauthenticated (P0, engine-side)

### Community 17 - "Kaafil SDK Playground README"
Cohesion: 0.50
Nodes (4): Playground app shell (#root + main.tsx entry), Repo gates: typecheck, test, build, simulate, allowBuilds esbuild allowlist, Kaafil SDK Playground README

### Community 18 - "errors.ts"
Cohesion: 0.83
Nodes (3): apiKeyClient(), attempt(), errorsSpecs()

### Community 19 - "Kaafil Gap Register"
Cohesion: 0.67
Nodes (3): GAPS.md upkeep obligation, B9: agency settings endpoints are consoleAuth, Kaafil Gap Register

### Community 20 - "Three-state badge vocabulary (sdk/plan/console)"
Cohesion: 0.67
Nodes (3): R4: Three-badge system (sdk/plan/console), Three-state badge vocabulary (sdk/plan/console), Reading the badges section

### Community 21 - "comms-no-production-sender (partly closed 2026-08-20)"
Cohesion: 0.67
Nodes (3): comms-email-has-no-address (unscheduled), comms-entirely-ungated (unscheduled), comms-no-production-sender (partly closed 2026-08-20)

## Knowledge Gaps
- **175 isolated node(s):** `PORT`, `kaafil`, `ALLOWLISTED_SDK_PATHS`, `JSON_HEADERS`, `Session` (+170 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `s()` connect `s` to `App.tsx`, `PlaygroundLogic`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `toFail()` connect `core.ts` to `transport.ts`, `specs/forms.ts`, `specs/travellers.ts`, `specs/test.ts`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `sdkCall()` connect `core.ts` to `specs/travellers.ts`, `specs/forms.ts`, `transport.ts`, `specs/test.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `PORT`, `kaafil`, `ALLOWLISTED_SDK_PATHS` to the rest of the system?**
  _175 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `core.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08328479906814211 - nodes in this community are weakly interconnected._
- **Should `s` be split into smaller, more focused modules?**
  _Cohesion score 0.05266106442577031 - nodes in this community are weakly interconnected._
- **Should `simulate.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06294326241134751 - nodes in this community are weakly interconnected._