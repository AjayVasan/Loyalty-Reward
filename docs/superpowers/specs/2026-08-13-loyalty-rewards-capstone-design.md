# Loyalty & Rewards Management — Design Spec

Source: Mercer Mettl capstone "AASE_QC_BTP Application Development" — *Retail Industry - Omni-Channel Customer Loyalty & Rewards Management*. Candidate: Ajayvasan S. This document is the agreed design for the implementation; it supersedes the raw PDF wherever this doc adds detail the PDF left unspecified.

## Business scenario (from source doc)

Retailers operate both e-commerce and physical outlets. Customers expect a unified rewards system that tracks purchases from all channels, dynamically assigns loyalty points, and handles redemptions while ensuring points never go below zero.

Roles: **Customer** (view points, redeem for discounts, track purchase history), **Retail Staff** (record new purchases — POS or Online), **Admin** (define/modify reward policies, e.g. ₹1 = 0.05 points).

## Architecture

Single CAP (Node.js) project. One `cds watch` locally in BAS, one `mta.yaml`, one `cf deploy` to Cloud Foundry — no microservices, no separate deployable units. SQLite for local dev, SAP HANA Cloud in the deployed target (CAP's standard hybrid profile switch, no code changes needed). One Fiori Elements UI bundle in the same project.

```
loyalty-rewards-cap/
  db/
    schema.cds          # entities below
    data/                # seed/mock CSVs (Sprint 1 deliverable)
  srv/
    service.cds          # exposed service, one file
    handlers.js           # Transaction/Redemption/Policy handlers
    lib/policy-cache.js    # in-memory write-through cache
  app/
    loyalty/              # Fiori Elements List Report + Object Page
  test/                    # test cases (Sprint 2/4)
  mta.yaml
  package.json
  docs/                    # deliverable documents (overview, sprint plan, test sheet, deployment steps, Build Code prompts)
```

## Data model (`db/schema.cds`)

Given entities kept as specified, with justified additions only (no unrelated fields):

**Customer** — `customerID` (UUID, key), `name`, `email`, `totalPoints` (Integer, spendable balance, decremented by redemption, must stay ≥ 0), **`lifetimePoints`** (Integer, new — cumulative points ever earned, never decremented, drives tier), `tier` (String — Bronze/Silver/Gold, derived).

*Why `lifetimePoints`*: if `tier` were derived from `totalPoints` alone, a Gold customer who fully redeems drops to Bronze instantly — punishing the behavior (redemption) the program should encourage. Real loyalty programs (airlines, retail) separate status-qualifying points from spendable balance for this reason. `lifetimePoints` is additive-only; `tier` is recomputed from it, never from `totalPoints`.

**Transaction** — as given: `txnID` (UUID, key), `customerID` (association to Customer), `channel` (String — "Online"/"Store"), `amount` (Decimal(10,2)), `txnDate` (DateTime), `pointsEarned` (Integer, computed by handler).

**Redemption** — as given: `redeemID` (UUID, key), `customerID` (association to Customer), `pointsUsed` (Integer), `redeemDate` (DateTime), `remarks` (String).

**RewardPolicy** (new) — `policyID` (UUID, key), `channel` (String, unique — "Online"/"Store"), `pointsPerCurrencyUnit` (Decimal(5,2)). Admin-editable. *Why*: the source doc requires "Admin: define and modify reward policies" but the given Domain Modelling section has no entity for it — this fills that gap.

**TierThreshold** (new) — `tier` (String, key — Bronze/Silver/Gold), `minLifetimePoints` (Integer). Admin-editable. *Why*: tier boundaries must live somewhere authoritative and editable, consistent with treating tier thresholds as a policy the admin owns.

## Caching strategy

- DB is the source of truth for `RewardPolicy` and `TierThreshold`.
- An in-memory object (`srv/lib/policy-cache.js`) is loaded once at service bootstrap from the DB.
- The hot path — computing `pointsEarned` on every `Transaction` insert — reads only from this in-memory cache, never the DB. This is the actual high-RPS path the caching concern was about.
- Admin writes to `RewardPolicy`/`TierThreshold` (low-frequency) update the DB and the in-memory cache in the same handler (write-through), so the cache never goes stale on the instance that served the write.
- Rejected approach: mutating `process.env` as a cache. It does not solve multi-instance consistency (each CF instance has its own process/env) and true persistence across restarts would require the app to call the CF platform API on itself — more fragile than the problem it solves. Documented here so the reasoning isn't lost.
- Known limitation, stated rather than hidden: with >1 CF instance, an admin update is immediately visible on the instance that handled it; other instances catch up on their next restart. Acceptable for this scope; pub/sub cache invalidation (e.g. Redis) would close this gap but is out of scope — deliberately not added per the "no Redis for this use case" decision.

## Handler logic (`srv/handlers.js`)

- **Transaction, before CREATE**: look up rate for `channel` from the cache → `pointsEarned = floor(amount × rate)` → increment the associated Customer's `totalPoints` and `lifetimePoints` by `pointsEarned` → recompute `tier` by comparing `lifetimePoints` against cached `TierThreshold` rows (highest threshold met wins).
- **Redemption, before CREATE**: reject with a 400 if `Customer.totalPoints < pointsUsed` (prevents negative balance — from the source doc's explicit handler-logic requirement). On success, decrement `totalPoints` only. `lifetimePoints`/`tier` are untouched.
- **RewardPolicy / TierThreshold, after CREATE/UPDATE/DELETE**: write-through update to the in-memory cache.

## Audit trail (new, user-requested)

Two distinct concerns, kept separate:

1. **Technical/operational logs** (errors, request traces) → `cds.log()` / stdout, picked up by SAP BTP's Application Logging Service. Not persisted in the business DB — high volume, not business data.
2. **Business audit trail** ("who changed what, when") → DB-backed, via the official `@cap-js/change-tracking` plugin, annotated (`@changelog`) on `Customer` (`totalPoints`, `lifetimePoints`, `tier`) and `RewardPolicy`/`TierThreshold` (rate/threshold edits). The plugin persists old→new value, actor, and timestamp automatically and provides a ready-made "Change History" facet for the Fiori Object Page — no hand-rolled log table or handler code needed.

*Why DB is fine here despite the earlier RPS concern*: that concern was about a **read**-hot path (every transaction re-reading a rate), fixed by the cache above. An audit entry is written once per genuine business **write** (a policy edit, or a transaction that changes a customer's points) — writes already hit the DB regardless, so one small additional audit row is proportional overhead, not amplification. `Transaction` and `Redemption` are deliberately excluded from change-tracking: they're already append-only ledger rows (never updated after creation), so they're already their own log entries.

## Authorization (CAP role-based)

Three roles — `customer`, `staff`, `admin` — via `@requires`/`@restrict` on the service:
- `customer`: read own Customer/Transaction/Redemption records; create own Redemption.
- `staff`: create Transaction records (record a purchase, POS or Online).
- `admin`: full CRUD on everything, including RewardPolicy, TierThreshold, and read access to the change-tracking Change History.

Mocked users (`alice`/customer, `bob`/staff, `carol`/admin) for local BAS dev via CAP's built-in mock auth; XSUAA role collections for the deployed Cloud Foundry target.

## UI

One Fiori Elements app bundle in `app/`, bound to the single CAP service:
- List Report on Customer → Object Page with embedded Transactions and Redemptions facets (via the associations), plus a Change History facet.
- A separate admin-only List Report for RewardPolicy and TierThreshold management.

## Deliverables (mapped to the source doc's table)

| Deliverable | Where |
|---|---|
| Project Overview Document | `docs/01-project-overview.md` |
| Data Model Design | `docs/02-data-model.md` (entities + relationships, incl. the two additions and why) |
| Service Definition | `srv/service.cds` |
| Agile Sprint Plan | `docs/03-sprint-plan.md` |
| Test Case Sheet | `docs/04-test-cases.md` |
| Deployment Steps | `docs/05-deployment-steps.md` (BAS → Build Code → Cloud Foundry) |
| Build Code prompts | `docs/06-build-code-prompts.md` — Joule/Build Code prompts to (re)generate each artifact, for the user to run in their own BTP subaccount to produce the actual "executed to display output" evidence, since this session has no live Build Code access |

## Seed data (initial DB rows only — not hardcoded, not a departure from the cache design above)

These are the starting contents of the `RewardPolicy`/`TierThreshold` **DB tables** on first deploy, supplied as CAP seed CSVs (`db/data/RewardPolicy.csv`, `db/data/TierThreshold.csv`) — the same seeding mechanism used for any CAP entity's initial data, nothing special-cased. No value here is read as a constant anywhere in code. On bootstrap these DB rows are loaded into the in-memory cache described above; every `pointsEarned`/tier computation reads only the cache. When admin edits a rate/threshold via the UI, the handler updates the DB row and the cache in the same request (write-through) — the change is permanent (survives restarts) because the DB row changed, not because of anything in code.

- RewardPolicy: Online = 0.05 points/₹, Store = 0.03 points/₹ (matches the source doc's example and rewards the online channel more, per its stated business reason).
- TierThreshold: Bronze = 0, Silver = 5000, Gold = 20000 lifetime points.

## Out of scope

- Multi-instance cache invalidation via pub/sub (Redis or similar) — explicitly deferred.
- Real POS/e-commerce channel integration — Retail Staff records purchases directly via the Fiori app, not via an external system feed.
- Versioned/time-sliced reward policies (e.g. rate effective date ranges) — one current rate per channel only.
