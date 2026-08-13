# Data Model

Defined in `db/schema.cds`.

## Customer

| Attribute | Type | Key | Description |
|---|---|---|---|
| customerID | UUID | ✓ | Unique identifier |
| name | String(120) | | Full name |
| email | String(254) | | Email address; also matches the authenticated user to their own record (`where: 'email = $user.email'`) |
| totalPoints | Integer | | Spendable balance — decremented by redemption, validated to stay ≥ 0 |
| lifetimePoints | Integer | | Cumulative points ever earned — never decremented; drives `tier` (added beyond the source spec: prevents a full redemption from instantly demoting a customer's tier) |
| tier | String(10) | | Bronze/Silver/Gold, derived from lifetimePoints via `srv/lib/tier.js` |
| transactions | Association to many Transaction | | Backlink for the Fiori Object Page's Purchases facet |
| redemptions | Association to many Redemption | | Backlink for the Fiori Object Page's Redemptions facet |

## Transaction

| Attribute | Type | Key | Description |
|---|---|---|---|
| txnID | UUID | ✓ | Unique identifier |
| customerID | Association to Customer | | Links to the purchasing customer. Named `customerID` per the source spec's literal Domain Modelling table — kept as-is even though, because Customer's own key is also `customerID`, this generates the physical/OData column `customerID_customerID` |
| channel | String(10) | | "Online" or "Store" — validated by the handler, not a schema enum |
| amount | Decimal(10,2) | | Purchase amount |
| txnDate | DateTime | | When the purchase occurred |
| pointsEarned | Integer | | Computed by the Transaction handler from the channel's RewardPolicy rate |

## Redemption

| Attribute | Type | Key | Description |
|---|---|---|---|
| redeemID | UUID | ✓ | Unique identifier |
| customerID | Association to Customer | | Links to the redeeming customer (same naming note as Transaction) |
| pointsUsed | Integer | | Points redeemed; validated against totalPoints before the record is created |
| redeemDate | DateTime | | When the redemption occurred |
| remarks | String(255) | | Reward item/offer details |

## RewardPolicy (added — fills a gap in the source spec)

| Attribute | Type | Key | Description |
|---|---|---|---|
| policyID | UUID | ✓ | Unique identifier |
| channel | String(10), `@assert.unique` | | "Online" or "Store" |
| pointsPerCurrencyUnit | Decimal(5,2) | | Admin-editable rate; seeded Online=0.05, Store=0.03 |

*Why added*: the source doc's Key Features table requires "Admin: define and modify reward
policies (e.g., ₹1 = 0.05 points)" but the given Domain Modelling section has no entity for it.

## TierThreshold (added — same reason)

| Attribute | Type | Key | Description |
|---|---|---|---|
| tier | String(10) | ✓ | Bronze/Silver/Gold |
| minLifetimePoints | Integer | | Minimum lifetimePoints to reach this tier; seeded 0/5000/20000 |

## Relationships

- `Customer 1 — * Transaction` via `Transaction.customerID`
- `Customer 1 — * Redemption` via `Redemption.customerID`
- `RewardPolicy`/`TierThreshold` are standalone admin-managed config, referenced by the
  Transaction/Redemption handlers through an in-memory write-through cache
  (`srv/lib/policy-cache.js`), not a direct DB association — the hot path (computing
  `pointsEarned` on every purchase) never hits the DB for rate lookups.

## Audit trail

`Customer.totalPoints/lifetimePoints/tier` and `RewardPolicy.pointsPerCurrencyUnit` /
`TierThreshold.minLifetimePoints` are annotated `@changelog` in `srv/service.cds`.
`@cap-js/change-tracking` auto-detects these annotations and adds a `changes` navigation
association to each entity, exposed at e.g. `/odata/v4/loyalty/Customers/{id}/changes`, with a
Change History facet on each entity's Fiori Object Page. `Transaction`/`Redemption` are
deliberately excluded — they're already append-only ledger rows, never updated after creation.
