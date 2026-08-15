# Working brief — `kaafil-js-examples`

Binding rules for anyone (human or agent) changing this repo. `README.md` explains the product to an
integrator; **this file explains the constraints to whoever edits it.** Where they overlap, README wins on
*what it does* and this file wins on *what you may not break*.

---

## 1. What this repo is

Two views of one product, driven by the same **73 method specs**:

- **`browser/`** — a React playground, one screen per module `kaafil-js` can reach, with a **Simulated**
  mode (no engine, no key, no network) and a **Connected** mode (real HTTP against a real engine).
- **`server/simulate.ts`** — a Node walkthrough of the trip lifecycle as **48 asserted steps** with an
  exit code.

Neither mocks the other. Connected mode and the Node script hit the identical endpoints described by the
identical vendored contract, `kaafil-js/openapi/openapi.json`.

**This repo is the project's consumer-shaped proof.** It has found a real defect in each of the last three
engine phases — defects every server-side gate passed over, because they were properties of the surface an
*integrator* has to write, not of any response. Treat a step you cannot drive as a finding, not an
inconvenience.

## 2. Layout

```
backend/server.ts        the ONLY process that reads KAAFIL_API_KEY. node:http, no framework. 4 routes.
browser/src/App.tsx      the playground shell
browser/src/ui/          presentational components (Header, Sidebar, Tabs, LogRail, Lanes, …)
browser/src/logic/       method specs, nav, viewmodel, guides, tour
browser/src/logic/sim/   the in-memory fixtures that make Simulated mode work with nothing running
browser/src/dc/          the only code with unit tests (`pnpm test` runs `browser/src/dc/*.test.ts`)
browser/.design/         extracted design system (fonts, global.css, template). Generated — see §7.
on-ground/client.ts      the raw-HTTP stopgap for managerAuth-only operations the SDK cannot reach
server/simulate.ts       the 48-step asserted walkthrough
GAPS.md                  the gap register — see §6, it has an upkeep obligation
```

## 3. The rules that are not negotiable

**R1 — `KAAFIL_API_KEY` is read in `backend/server.ts` and nowhere else.** A partner API key in a browser
bundle is a key anyone opening devtools now holds. No browser file may import it, receive it as a prop, or
accept it from a query string. If a screen needs API-key work, it goes through a backend route.

**R2 — the two SDK entry points stay separate at the module-graph level, not by convention.**
`kaafil-js` (server entry, API key, Node only) is used by `server/simulate.ts` and `backend/server.ts`.
`kaafil-js/client` (browser entry, manager session) is used by the playground. `kaafil-js/client` must have
**no code path that imports the API-key branch even by accident**. Do not "temporarily" cross them.

**R3 — Simulated mode needs nothing running.** No engine, no key, no backend, no `.env`. Every screen is
backed by `browser/src/logic/sim/`. If a change makes any Simulated screen require a network call, the
change is wrong. This is the repo's best feature and the first thing a new reader touches.

**R4 — the three badges mean exactly three things, and `raw` is not `broken`:**

| badge | meaning | runs for real in Connected mode? |
|---|---|---|
| `sdk` | a typed `kaafil-js` method exists **and** a shipped entry point satisfies its scheme | yes, via the SDK |
| `raw` | the endpoint is live, but no SDK client can reach it (`managerAuth`-only writes) | **yes, via `on-ground/`** — an SDK gap, not a product gap |
| `plan` | there is no endpoint at all, or it is `consoleAuth`-only and always will be | no — this is the stub set |

Collapsing "no SDK path" into "no path" is a mistake this repo has already made once and corrected in
writing (`README.md`, "Corrected after synthesis"). Do not re-make it.

**R5 — errors are re-serialised faithfully**, never swallowed or reshaped:
`{ error: { name, code, status, message, details, fields, retryable } }`. A Connected-mode failure and a
Simulated one must read identically in the response panel. That symmetry is what makes Simulated mode
trustworthy.

**R6 — Connected mode's manager lane goes DIRECT from the tab to the engine**, and that is deliberate: it
is the real shape of a manager's device. Do not interpose a proxy a real deployment would not have. The
consequence is that the engine's `CORS_ORIGIN` must allowlist `http://localhost:5173`, and a CORS failure
there is indistinguishable from the network being down — if the manager half of the playground dies at
preflight, check `CORS_ORIGIN` before anything else.

**R7 — `kaafil-js` resolves as a pinned exact version (`"0.1.0-beta.1"`) from the real npm registry**,
not a range. `pnpm install` alone is the whole setup — no sibling checkout, no `npm link`, no vendored
copy. Pin exact through the beta series (a floating `^0.1.0-beta.x` range is how this repo would silently
break on a beta bump); only move to a caret range once `kaafil-js` cuts an actual stable (non-`-beta`)
release. Note npm's dist-tag wrinkle, still live: the package's first-ever publish (`0.1.0-beta.0`)
permanently claimed `latest` (npm always does this on a first publish, regardless of `--tag`), and every
publish since has moved only `beta` forward — `beta` now points at `0.1.0-beta.1`, but `latest` is still
stuck on the older `0.1.0-beta.0`. An unqualified `npm install kaafil-js` therefore installs the **older**
version, with the base-URL default bug this repo's own base URL now avoids by pinning exact. This only
resolves once an actual stable version publishes and moves `latest` forward.

**R8 — `packageManager` and `.nvmrc` are pinned** (pnpm, Node 20.11.1; `engines` requires >=20.11). Do not
bump either as a side effect of another change.

## 4. Gates

Run from this directory. All three are green as shipped and must stay green:

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # tsx --test browser/src/dc/*.test.ts   (13 tests)
pnpm build         # tsc --noEmit && vite build browser
```

The walkthrough is the fourth gate and needs a live engine:

```bash
pnpm simulate      # 48 asserted steps, exit code is the result
```

**A failing `simulate` step is a finding.** Before reporting it as an engine defect, check the harness —
this project's own history has several cases where a wrong stamp, a missing host rewrite, or a stale
container looked exactly like a product bug.

## 5. When you add a method screen

Every screen is driven by a spec in `browser/src/logic/`, not by bespoke component code. Add the spec,
give it the correct badge per R4, and add its Simulated fixture in `browser/src/logic/sim/` — a screen
that only works in Connected mode breaks R3.

## 6. `GAPS.md` has an upkeep obligation

It is a register built **deliberately against the vendored contract, not against engine source** — that is
the point, and it must stay that way: it records what an integrator holding the published spec can and
cannot do.

**When a gap closes, move it — do not leave it to rot.** A register that lists a shipped capability as
missing is worse than no register, because it is read as current. Each row carries a "lands in" phase;
when that phase ships, re-verify the row against the **newly vendored** spec and either delete it or
rewrite it with what actually remains.

Keep §2's **boundaries** separate from §3's **gaps**. A boundary is a designed refusal (`consoleAuth`-only
administration, no `POST /agencies`, reviews/tickets deferred by `D-025`); filing it as a gap invites
someone to "fix" a deliberate decision.

## 7. `browser/.design/` is generated

Produced by `scripts/extract-design.mjs` (`pnpm extract:design`). Edit the extractor or the source design,
not the output. Hand-edits there are lost on the next run.

## 8. Cross-repo facts worth knowing before you change anything

- The **contract moves**. `kaafil-js/openapi/openapi.json` is vendored, and the engine's own
  `openapi:check` guards the producer side — but a vendored copy is **a second artefact with its own
  drift**, and it has been two waves stale before. Re-vendor before assuming an operation is missing.
- **`shareAuth` was accepted by zero operations** when `GAPS.md` was written. That is no longer true — the
  traveller share fetch surface and the forms write-back both shipped. Re-check before repeating it.
- The engine's background **worker must be running** for Connected mode: `trips.upsert` and manager
  assignment enqueue a journey build, and `journey.get` answers `404` until a worker lands it.
