# Loyalty & Rewards Management

Retail Omni-Channel Customer Loyalty & Rewards Management — a CAP (Cloud Application
Programming Model) capstone project. Tracks purchases across online and in-store channels,
computes loyalty points dynamically per channel, and lets customers redeem points while keeping
their balance ≥ 0. Built for SAP Business Application Studio, deployable as a single MTA to SAP
BTP Cloud Foundry with SAP HANA Cloud.

## Quick start

```bash
npm install
npm test        # 12 automated tests, in-memory SQLite, ~2s
cds watch        # local dev server on http://localhost:4004
```

Mock users for local dev (see `package.json`'s `cds.requires.auth`): `alice`/`customer`,
`bob`/`staff`, `carol`/`admin` (blank password locally).

## Project structure

```
db/schema.cds          Domain model: Customer, Transaction, Redemption, RewardPolicy, TierThreshold
srv/service.cds         LoyaltyService (/odata/v4/loyalty) + role-based @restrict + @changelog
srv/ui-annotations.cds  Fiori UI annotations (List Report/Object Page/value-help)
srv/handlers/            Transaction, Redemption, RewardPolicy/TierThreshold write-through
srv/lib/                 policy-cache.js (in-memory rate cache), tier.js (pure tier logic)
app/                     4 Fiori Elements apps: customers, transactions, reward-policy, tier-threshold
test/                    12 automated tests (node:test + cds.test())
docs/                    Deliverables: overview, data model, sprint plan, test cases, deployment, Build Code prompts
docs/superpowers/specs/  Full design spec with every decision's reasoning
docs/superpowers/plans/  Task-by-task implementation plan (as actually executed, including bugs found/fixed)
```

## Design decisions

The source assessment's Domain Modelling table only specifies `Customer`, `Transaction`, and
`Redemption`. Everything below was a deliberate addition or deviation, each made to close a real
gap rather than arbitrarily — the full reasoning (including the back-and-forth that led to each
one) lives in `docs/superpowers/specs/2026-08-13-loyalty-rewards-capstone-design.md`; this is the
short version.

### Why a write-through in-memory cache instead of env vars or Redis

`RewardPolicy` (points-per-currency-unit rates) and `TierThreshold` (tier boundaries) are read on
every single purchase — the actual high-RPS path in this system — but only ever written by rare
admin edits. Hitting the DB for a rate lookup on every transaction doesn't scale; caching is the
right instinct. Two other options were considered and rejected first:

- **Environment variable as the cache**: mutating `process.env` at runtime does update the
  current process's view, but it does not solve the actual problem. Cloud Foundry runs multiple
  app instances for availability — a mutation in one instance's process is invisible to the
  others, so admin updates become instance-inconsistent the moment you scale past one instance.
  Making it survive a real restart would require the app to call the Cloud Foundry platform API
  on itself to rewrite its own env var, coupling business logic to deployment-platform
  credentials just to cache a number — a bigger, more fragile surface than the problem it solves.
- **Redis**: would solve the multi-instance consistency gap properly (pub/sub invalidation), but
  is unjustified infrastructure for two tables with a handful of rows each, updated rarely, in a
  project explicitly scoped to stay a single deployable unit.

**What we built instead**: `srv/lib/policy-cache.js` loads `RewardPolicy`/`TierThreshold` into a
plain in-memory object once at service bootstrap (`cds.on('served', ...)` in `srv/service.js`).
The hot path (`srv/handlers/transaction.js` computing `pointsEarned` on every purchase) reads
only from this cache — zero DB hits. Admin writes to either table trigger an `after`-handler
(`srv/handlers/policy.js`) that reloads the cache from the DB in the same request — write-through,
so the instance that served the write is correct immediately, no stale window on that instance.

**Known, accepted limitation**: with more than one CF instance, an admin's update is immediately
correct on the instance that handled it; other instances catch up on their next restart. Closing
that gap needs pub/sub invalidation (Redis or similar) — deliberately out of scope for this
project's size, and documented here rather than hidden.

**Implementation note surfaced during build**: the cache reload must use bare `SELECT`/`UPDATE`
statements (not `srv.run`/`srv.tx`), not for caching reasons but because a *nested* transaction
opened from inside an already-active request transaction deadlocks against SQLite's single
connection — see `srv/lib/policy-cache.js` and `srv/handlers/transaction.js` for the comments,
and the plan doc's Task 5/7 sections for how this was diagnosed.

### Why `Customer.lifetimePoints` is separate from `totalPoints`

If tier were derived from `totalPoints` (the spendable balance) alone, a Gold customer who fully
redeems their points would instantly drop to Bronze — punishing the exact behavior (redeeming)
the program should encourage. Real loyalty programs (airlines, retail) separate
status-qualifying points from spendable balance for this reason. `lifetimePoints` is
additive-only, driven by `srv/lib/tier.js`; `totalPoints` is the only field redemption touches.

### Why `RewardPolicy` and `TierThreshold` exist at all

The source doc's Key Features table requires "Admin: define and modify reward policies" but the
given Domain Modelling section has no entity for it — these two entities fill that gap, seeded
with the doc's own example rate (Online = 0.05, Store = 0.03 points/₹) and admin-only via
`@restrict` (confirmed against the Key Features table, which never mentions Customer/Staff
viewing rates).

### Why the `customerID` association is named that, not `customer`

CDS's foreign-key naming convention (`<association>_<target-key>`) means an association literally
named `customerID` targeting a `Customer` whose own key is also `customerID` generates the odd
column `customerID_customerID`. A cleaner name was considered and briefly adopted, then reverted
on explicit instruction to follow the source PDF's literal field names strictly, even at the cost
of that awkward generated name — see `db/schema.cds` for the resulting comment.

### Why the audit trail is DB-backed via `@cap-js/change-tracking`, not env/Redis-cached

This is a different kind of read/write shape than the rate cache above: an audit entry is written
once per genuine business write (a policy edit, or a transaction that changes a customer's
points), and writes already have to hit the DB regardless — so there's no read-amplification
problem to cache away, and no conflict with the caching decision above. Scoped to
`Customer.totalPoints/lifetimePoints/tier` and `RewardPolicy`/`TierThreshold`'s rate/threshold
fields only — `Transaction`/`Redemption` are already append-only ledger rows, so tracking
"changes" to something never updated after creation would be a no-op.

## Full documentation

- `docs/01-project-overview.md` through `docs/06-build-code-prompts.md` — the assessment's
  required deliverables.
- `docs/superpowers/specs/2026-08-13-loyalty-rewards-capstone-design.md` — the complete design
  spec, including every option considered and rejected, in the order the decisions were made.
- `docs/superpowers/plans/2026-08-13-loyalty-rewards-capstone.md` — the task-by-task
  implementation plan, updated in place as it was executed, including the real bugs hit
  (SQLite native build vs. Node version, a transaction-authorization edge case, a test-runner
  hang caused by Fiori tooling) and exactly how each was diagnosed and fixed.
