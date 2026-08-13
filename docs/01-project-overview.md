# Project Overview — Retail Omni-Channel Customer Loyalty & Rewards Management

## Objective

Develop a Loyalty and Rewards Management System that integrates online and in-store customer
transactions, computes loyalty points dynamically per channel, and allows redemption through
multiple channels while ensuring a customer's point balance never goes negative.

## Scope

- Three roles: **Customer** (view points, redeem for discounts, track purchase history),
  **Retail Staff** (record purchases, POS or Online), **Admin** (define/modify reward policies
  and tier thresholds).
- Single CAP (Node.js) service (`LoyaltyService` at `/odata/v4/loyalty/`), single deployable MTA,
  SAP HANA Cloud in production, PostgreSQL for local BAS development.
- Three Fiori Elements apps, all bound to the one service:
  - **Customer Loyalty** (`app/customers-app`) — customer self-service and admin master view,
    with Transactions/Redemptions/Change History facets on the Customer Object Page.
  - **Record Purchase** (`app/transactions-app`) — staff-facing purchase entry with customer
    search.
  - **Reward Policies** / **Tier Thresholds** (`app/reward-policy-app`, `app/tier-threshold-app`)
    — admin-only rate and threshold management.
- DB-backed audit trail of point/policy changes via `@cap-js/change-tracking`, scoped to
  `Customer.totalPoints/lifetimePoints/tier` and `RewardPolicy`/`TierThreshold` rate/threshold
  fields.

## High-Level Flow

```
Retail Staff records a purchase (channel: Online/Store, amount)
        │
        ▼
Transaction.before(CREATE) handler (srv/handlers/transaction.js)
  - validates channel and amount
  - looks up the current rate for the channel from the in-memory policy cache
  - computes pointsEarned = floor(amount × rate)
  - updates Customer.totalPoints (+= pointsEarned) and Customer.lifetimePoints (+= pointsEarned)
  - recomputes Customer.tier from lifetimePoints against cached tier thresholds
        │
        ▼
Customer views points/tier/history, or redeems points
        │
        ▼
Redemption.before(CREATE) handler (srv/handlers/redemption.js)
  - rejects if pointsUsed > Customer.totalPoints
  - on success, decrements Customer.totalPoints only (lifetimePoints/tier untouched —
    a customer's tier survives even a full redemption)
        │
        ▼
Admin edits RewardPolicy/TierThreshold via the admin apps
  - DB row updated, then the in-memory policy cache is reloaded (write-through,
    srv/handlers/policy.js) — takes effect on the very next purchase, no restart needed
  - every change is recorded to the DB-backed Change History (@cap-js/change-tracking)
```

## Architecture

One CAP project — `db/` (domain model), `srv/` (service, handlers, UI annotations), `app/`
(four Fiori Elements apps), one `mta.yaml`. No microservices, no separate deployable units.
Role-based authorization enforced via CDS `@restrict` annotations, mapped to XSUAA scopes in
production (`xs-security.json`, auto-derived from the model by `cds add xsuaa`).
