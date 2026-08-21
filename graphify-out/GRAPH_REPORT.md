# Graph Report - kaafil-js-examples  (2026-08-21)

## Corpus Check
- 100 files · ~144,034 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 549 nodes · 1236 edges · 50 communities (25 shown, 25 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Playground Logic Core & Live Lane
- Design Canvas Hover/Style System
- Server Simulate Assertions
- Live Offline Lane
- Package & Workspace Config
- Live Invariant Tests & Guides
- Backend Server & Agency Admin Session
- TypeScript Refs (DOM/Backend/Browser)
- Design Extraction Scripts
- Simulated Forms Fixtures
- Design Canvas Highlight/Bash
- Simulated Agencies & Travellers Fixtures
- Design Canvas App & Logic
- Design Canvas Registry Tests
- Live Transport & Sim Test Fixtures
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 48
- Community 49

## God Nodes (most connected - your core abstractions)
1. `toFail()` - 74 edges
2. `s()` - 62 edges
3. `sdkCall()` - 58 edges
4. `okLive()` - 47 edges
5. `okFromSdk()` - 44 edges
6. `managerClient()` - 37 edges
7. `resolveAgencyRef()` - 26 edges
8. `unwrapSdk()` - 20 edges
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
- `R1: API key read only in backend/server.ts` --references--> `Why the API key lives here, and only here`  [EXTRACTED]
  CLAUDE.md → backend/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-badge taxonomy (sdk/plan/console) shared across CLAUDE.md, README.md, GAPS.md** — claude_md_r4_badge_system, readme_badge_reading, gaps_badge_taxonomy [EXTRACTED 1.00]
- **Simultaneous 2026-08-16 closure by kaafil-js@0.1.0-beta.3** — gaps_onground_write_unreachable, gaps_no_offline_outbox, gaps_closing_day_unbuilt [EXTRACTED 1.00]
- **API-key-stays-server-side boundary enforced across rule, implementation, and docs** — claude_md_r1_api_key_boundary, backend_readme_api_key_isolation, readme_backend_routes [EXTRACTED 1.00]

## Communities (50 total, 25 thin omitted)

### Community 0 - "Playground Logic Core & Live Lane"
Cohesion: 0.08
Nodes (73): PlaygroundLogicProps, LiveFail, LiveOk, okFromSdk(), okLive(), toFail(), unwrapSdk(), managerClient() (+65 more)

### Community 1 - "Design Canvas Hover/Style System"
Cohesion: 0.07
Nodes (36): Hov(), HovOwnProps, cache, kebabToCamel(), parse(), s(), sx(), ErrorBoundary (+28 more)

### Community 2 - "Server Simulate Assertions"
Cohesion: 0.06
Nodes (39): assertEquals(), AssertionFailure, assertJsonEquals(), assertTrue(), BlockedRecord, BlockedStep, ItineraryItem, ItineraryRead (+31 more)

### Community 3 - "Live Offline Lane"
Cohesion: 0.09
Nodes (38): sectionsForSubject(), closeHeld(), databaseNameFor(), Held, OfflineEngine, offlineEngineFor(), resetOfflineEngine(), sessionRequired() (+30 more)

### Community 4 - "Package & Workspace Config"
Cohesion: 0.04
Nodes (44): kaafil-js, comment:play, comment:pnpm, dependencies, kaafil-js, react, react-dom, shiki (+36 more)

### Community 5 - "Live Invariant Tests & Guides"
Cohesion: 0.12
Nodes (21): PlaygroundLogic, guides(), setBackendUrl(), HELPERS, seedSim(), guideVals(), TOUR, tourGo() (+13 more)

### Community 6 - "Backend Server & Agency Admin Session"
Cohesion: 0.15
Nodes (22): AgencyAdminSession, ALLOWLISTED_SDK_PATHS, callAllowlistedSdkPath(), handleAgencyAdminSession(), handleGetTrip(), handlePushManifest(), handleSdk(), handleSession() (+14 more)

### Community 7 - "TypeScript Refs (DOM/Backend/Browser)"
Cohesion: 0.08
Nodes (24): backend/**/*.ts, browser/**/*.ts, browser/**/*.tsx, DOM, ES2022, node, server/**/*.ts, compilerOptions (+16 more)

### Community 8 - "Design Extraction Scripts"
Cohesion: 0.10
Nodes (17): fontNames, fonts, helmet, helmetEnd, helmetOpen, HERE, html, logic (+9 more)

### Community 9 - "Simulated Forms Fixtures"
Cohesion: 0.23
Nodes (15): BINDINGS_FIXTURE, FIELD_KINDS, FORM_FIXTURE, FORM_PHASES, cloneFixture(), ensureDispatch(), ensureFormResponses(), ensureForms() (+7 more)

### Community 10 - "Design Canvas Highlight/Bash"
Cohesion: 0.17
Nodes (8): Code(), CodeLang, CodeProps, getHighlighter(), highlight(), highlightCache, unwrap(), useHighlighted()

### Community 11 - "Simulated Agencies & Travellers Fixtures"
Cohesion: 0.29
Nodes (8): AGENCY_FIXTURE, AGENCY_MANAGER_DIRECTORY_FIXTURE, AGENCY_SETTINGS_FIXTURE, AGENCY_TRAVELLER_DIRECTORY_FIXTURE, dsarBundleFixture(), TRAVELLER_ERASE_CASCADE_TEMPLATE, TRIP_MANIFEST_FIXTURE, KNOWN_TRAVELLER_REFS

### Community 12 - "Design Canvas App & Logic"
Cohesion: 0.29
Nodes (4): App(), DCLogic, useLogic(), useLogicInstance()

### Community 13 - "Design Canvas Registry Tests"
Cohesion: 0.27
Nodes (6): logic, navIds, NON_METHOD_SCREENS, METHODS, GROUPS, TITLES

### Community 14 - "Live Transport & Sim Test Fixtures"
Cohesion: 0.42
Nodes (7): resolveEnvironment(), FIXTURE_REF_MAP_FIXTURE, initialTestClock(), SANDBOX_QUOTA_FIXTURE, buildRefusal(), refuseUnlessTestPlane(), testSpecs()

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (7): GET /entitlement/:agencyRef answers a real 501, The four routes — the real contract, R5: Errors re-serialised faithfully, B1: consoleAuth-only admin operations, The four routes the backend owns, The typed error model (KaafilValidationError etc.), Node walkthrough — pnpm simulate, 57 steps

### Community 16 - "Community 16"
Cohesion: 0.40
Nodes (5): R2: SDK entry points stay separate at module-graph level, closing-day-unbuilt (CLOSED 2026-08-16, Phase 14), no-offline-outbox (CLOSED 2026-08-16, Phase 15), onground-write-unreachable (CLOSED 2026-08-16), sync-push-share-unauthenticated (P0, engine-side)

### Community 17 - "Community 17"
Cohesion: 0.50
Nodes (4): Playground app shell (#root + main.tsx entry), Repo gates: typecheck, test, build, simulate, allowBuilds esbuild allowlist, Kaafil SDK Playground README

### Community 18 - "Community 18"
Cohesion: 0.83
Nodes (3): apiKeyClient(), attempt(), errorsSpecs()

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (3): GAPS.md upkeep obligation, B9: agency settings endpoints are consoleAuth, Kaafil Gap Register

### Community 20 - "Community 20"
Cohesion: 0.67
Nodes (3): R4: Three-badge system (sdk/plan/console), Three-state badge vocabulary (sdk/plan/console), Reading the badges section

### Community 21 - "Community 21"
Cohesion: 0.67
Nodes (3): comms-email-has-no-address (unscheduled), comms-entirely-ungated (unscheduled), comms-no-production-sender (partly closed 2026-08-20)

## Knowledge Gaps
- **174 isolated node(s):** `PORT`, `kaafil`, `ALLOWLISTED_SDK_PATHS`, `JSON_HEADERS`, `Session` (+169 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `s()` connect `Design Canvas Hover/Style System` to `Design Canvas App & Logic`, `Live Invariant Tests & Guides`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `toFail()` connect `Playground Logic Core & Live Lane` to `Live Offline Lane`, `Simulated Forms Fixtures`, `Simulated Agencies & Travellers Fixtures`, `Live Transport & Sim Test Fixtures`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `sdkCall()` connect `Playground Logic Core & Live Lane` to `Simulated Agencies & Travellers Fixtures`, `Simulated Forms Fixtures`, `Live Offline Lane`, `Live Transport & Sim Test Fixtures`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `PORT`, `kaafil`, `ALLOWLISTED_SDK_PATHS` to the rest of the system?**
  _174 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Playground Logic Core & Live Lane` be split into smaller, more focused modules?**
  _Cohesion score 0.08484848484848485 - nodes in this community are weakly interconnected._
- **Should `Design Canvas Hover/Style System` be split into smaller, more focused modules?**
  _Cohesion score 0.06777493606138107 - nodes in this community are weakly interconnected._
- **Should `Server Simulate Assertions` be split into smaller, more focused modules?**
  _Cohesion score 0.06294326241134751 - nodes in this community are weakly interconnected._