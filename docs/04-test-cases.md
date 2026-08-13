# Test Case Sheet

All 12 automated cases below pass via `npm test` (Node's built-in `node:test` +
`@sap/cds`'s `cds.test()` harness against an in-memory SQLite database).

| # | Scenario | Steps | Expected Result | Automated in |
|---|---|---|---|---|
| 1 | Anonymous access blocked | GET /Customers with no auth | 401 | test/srv/auth.test.js |
| 2 | Admin full access | GET /Customers, /RewardPolicies as carol | 200 for both | test/srv/auth.test.js |
| 3 | Staff scoped access | GET /Customers as bob (200); GET /RewardPolicies as bob | 403 on policies | test/srv/auth.test.js |
| 4 | Customer sees only own record | GET /Customers as alice | 200, exactly 1 row (alice's) | test/srv/auth.test.js |
| 5 | Online purchase points | POST Transaction, channel=Online, amount=1000 | pointsEarned=50 (rate 0.05); Customer.totalPoints/lifetimePoints += 50 | test/srv/transaction.test.js |
| 6 | Invalid channel rejected | POST Transaction, channel=Mail | 400 | test/srv/transaction.test.js |
| 7 | Redemption within balance | POST Redemption, pointsUsed <= totalPoints | 200; totalPoints decremented; lifetimePoints/tier unchanged | test/srv/redemption.test.js |
| 8 | Redemption over balance rejected | POST Redemption, pointsUsed > totalPoints | 400; totalPoints unchanged | test/srv/redemption.test.js |
| 9 | Live rate change | Admin PATCHes Online rate 0.05→0.10, then a purchase is recorded | New purchase uses 0.10, no restart needed | test/srv/policy-cache.test.js |
| 10 | Audit trail on points change | Purchase changes Customer.totalPoints | A Change History entry exists under /Customers/{id}/changes | test/srv/change-tracking.test.js |
| 11 | Tier survives full redemption | Reach Gold via purchases, redeem down to 0 totalPoints | tier remains Gold (lifetimePoints untouched) | manual — see below |
| 12 | RewardPolicy channel uniqueness | Attempt to create a second RewardPolicy row with channel=Online | Rejected by @assert.unique | manual — see below |

## Manual test 11 — tier survives full redemption

1. As staff (`bob`), POST several Transactions for the demo customer until `lifetimePoints >= 20000` (Gold).
2. As the customer (`alice`), POST a Redemption for the full `totalPoints` balance.
3. GET the customer record: `tier` is still `Gold`, `totalPoints` is `0`, `lifetimePoints` is unchanged.

## Manual test 12 — RewardPolicy uniqueness

1. As admin (`carol`), POST a new RewardPolicy with `channel: "Online"`.
2. Expect a 400 rejection referencing the `channel` uniqueness constraint.

## UI verification (visual, done via `cds watch` + browser — see docs/05-deployment-steps.md)

| # | Scenario | Expected |
|---|---|---|
| 13 | Customer Loyalty app renders | List Report shows the demo customer; Object Page shows Purchases/Redemptions/Change History facets |
| 14 | Record Purchase app, customer search | Typing in the customer field on a new Transaction shows a value-help matching by name/email |
| 15 | Admin apps blocked in UI for non-admin | Reward Policies / Tier Thresholds apps return 403 when accessed as staff/customer |

## Environment note

Local test execution requires `NODE_ENV=test` (selects the in-memory SQLite profile) and
`CDS_PLUGIN_UI5_ACTIVE=false` (prevents `cds-plugin-ui5`'s dev-time livereload/proxy server from
holding the test process open) — both already wired into `package.json`'s `test` script.
