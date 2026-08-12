# Loyalty & Rewards Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full CAP (Node.js) backend, role-based auth, in-memory write-through policy cache, DB-backed audit trail, and three Fiori Elements apps for the Mercer Mettl "Retail Omni-Channel Customer Loyalty & Rewards Management" capstone, matching the approved design spec exactly.

**Architecture:** One CAP project (`db/`, `srv/`, `app/`), one `mta.yaml`, one deployable unit. SQLite in-memory for automated tests, PostgreSQL for local `cds watch` (matching the BAS template already created), SAP HANA Cloud in the deployed target. Business logic lives in small handler modules wired from a single `srv/service.js` entry point; UI is three Fiori Elements List Report/Object Page apps under `app/`, all bound to the one `LoyaltyService`.

**Tech Stack:** `@sap/cds` (Node.js CAP runtime), `@cap-js/postgres`, `@cap-js/hana`, `@cap-js/sqlite` (test), `@cap-js/change-tracking`, `@sap/xssec` (XSUAA), Node's built-in `node:test` + `node:assert/strict`, SAP Fiori tools (`generate_fiori_app_cap` via the sap-fiori-mcp-server MCP tool).

## Global Constraints

- Single CAP project, single `mta.yaml`, single deploy — no additional services or microservices (per approved design spec).
- Field/entity names copied from the source PDF's Domain Modelling table are kept **literally**, including the `customerID` association name on `Transaction`/`Redemption` — even though this produces the generated column `customerID_customerID` (CAP's `<association>_<target-key>` convention, since Customer's own key is also `customerID`). Do not rename it.
- Seed values: RewardPolicy — Online = `0.05`, Store = `0.03` (points per ₹1). TierThreshold — Bronze = `0`, Silver = `5000`, Gold = `20000` lifetime points.
- Mock users for dev/test: `alice` (role `customer`, attr `email: alice@example.com`), `bob` (role `staff`), `carol` (role `admin`).
- `RewardPolicy`/`TierThreshold` are admin-only for both read and write (confirmed against the source PDF's Key Features table).
- `Customer.totalPoints` is the spendable balance (decremented by redemption, must stay ≥ 0). `Customer.lifetimePoints` is cumulative and never decremented; `tier` is derived from `lifetimePoints` only.
- Service path is fixed at `/odata/v4/loyalty/` via an explicit `@path` annotation (not left to convention).
- Node.js — this machine runs v26.4.0; CAP officially targets even-numbered LTS (22/24). If `npm install`/`cds watch` reports engine warnings, they're expected and not blocking; only stop and investigate if a command actually errors.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: the `cds.requires.db`/`cds.requires.auth` profile config every later task's tests rely on (`[test]` profile = sqlite in-memory + mocked users with blank passwords; `[development]` = postgres + mocked users with `pass`; `[production]` = hana + xsuaa).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "loyalty-rewards",
  "version": "1.0.0",
  "description": "Retail Omni-Channel Customer Loyalty & Rewards Management",
  "license": "UNLICENSED",
  "private": true,
  "dependencies": {
    "@sap/cds": "^8",
    "@sap/xssec": "^4",
    "@cap-js/postgres": "^1",
    "@cap-js/hana": "^1",
    "@cap-js/change-tracking": "^1"
  },
  "devDependencies": {
    "@cap-js/sqlite": "^1",
    "@sap/cds-dk": "^8"
  },
  "scripts": {
    "start": "cds-serve",
    "watch": "cds watch",
    "test": "NODE_ENV=test node --test"
  },
  "engines": {
    "node": ">=20"
  },
  "cds": {
    "requires": {
      "db": { "kind": "sql" },
      "[development]": {
        "db": { "kind": "postgres" },
        "auth": {
          "kind": "mocked",
          "users": {
            "alice": { "password": "pass", "roles": ["customer"], "attr": { "email": "alice@example.com" } },
            "bob":   { "password": "pass", "roles": ["staff"] },
            "carol": { "password": "pass", "roles": ["admin"] }
          }
        }
      },
      "[test]": {
        "db": { "kind": "sqlite", "credentials": { "url": ":memory:" } },
        "auth": {
          "kind": "mocked",
          "users": {
            "alice": { "password": "", "roles": ["customer"], "attr": { "email": "alice@example.com" } },
            "bob":   { "password": "", "roles": ["staff"] },
            "carol": { "password": "", "roles": ["admin"] }
          }
        }
      },
      "[production]": {
        "db": { "kind": "hana" },
        "auth": { "kind": "xsuaa" }
      }
    }
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
gen/
.cdsrc-private.json
*.log
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes without errors (engine warnings about Node version are OK; any hard failure is not).

- [ ] **Step 4: Verify the CDS toolchain resolves**

Run: `npx cds version`
Expected: prints `@sap/cds-dk` and `@sap/cds` versions with no error.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "Scaffold CAP project: dependencies and db/auth profiles"
```

---

### Task 2: Domain model and seed data

**Files:**
- Create: `db/schema.cds`
- Create: `db/data/loyalty-Customer.csv`
- Create: `db/data/loyalty-RewardPolicy.csv`
- Create: `db/data/loyalty-TierThreshold.csv`
- Test: `test/schema.test.js`

**Interfaces:**
- Produces: `loyalty.Customer` (`customerID`, `name`, `email`, `totalPoints`, `lifetimePoints`, `tier`), `loyalty.Transaction` (`txnID`, `customerID` assoc, `channel`, `amount`, `txnDate`, `pointsEarned`), `loyalty.Redemption` (`redeemID`, `customerID` assoc, `pointsUsed`, `redeemDate`, `remarks`), `loyalty.RewardPolicy` (`policyID`, `channel` unique, `pointsPerCurrencyUnit`), `loyalty.TierThreshold` (`tier` key, `minLifetimePoints`).

- [ ] **Step 1: Write the failing test**

```js
// test/schema.test.js
const cds = require('@sap/cds')
const test = require('node:test')
const assert = require('node:assert/strict')

cds.test(__dirname + '/..')

test('seed data loads: 2 reward policies, 3 tier thresholds, 1 demo customer', async () => {
  const { RewardPolicy, TierThreshold, Customer } = cds.entities('loyalty')
  const policies = await SELECT.from(RewardPolicy)
  const thresholds = await SELECT.from(TierThreshold)
  const customers = await SELECT.from(Customer)

  assert.equal(policies.length, 2)
  assert.equal(policies.find(p => p.channel === 'Online').pointsPerCurrencyUnit, 0.05)
  assert.equal(policies.find(p => p.channel === 'Store').pointsPerCurrencyUnit, 0.03)

  assert.equal(thresholds.length, 3)
  assert.equal(thresholds.find(t => t.tier === 'Gold').minLifetimePoints, 20000)

  assert.equal(customers.length, 1)
  assert.equal(customers[0].email, 'alice@example.com')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/schema.test.js`
Expected: FAIL — no model / entities found (`db/schema.cds` doesn't exist yet).

- [ ] **Step 3: Write the domain model**

```cds
// db/schema.cds
namespace loyalty;

entity Customer {
  key customerID   : UUID;
  name             : String(120);
  email            : String(254);
  totalPoints      : Integer default 0;
  lifetimePoints   : Integer default 0;
  tier             : String(10) default 'Bronze';
}

entity Transaction {
  key txnID        : UUID;
  // Named `customerID` per the source spec's literal Domain Modelling table.
  // Because Customer's own key is also `customerID`, this generates the
  // physical/OData column `customerID_customerID` — kept deliberately.
  customerID       : Association to Customer;
  channel          : String(10);
  amount           : Decimal(10,2);
  txnDate          : DateTime;
  pointsEarned     : Integer default 0;
}

entity Redemption {
  key redeemID     : UUID;
  customerID       : Association to Customer;
  pointsUsed       : Integer;
  redeemDate       : DateTime;
  remarks          : String(255);
}

entity RewardPolicy {
  key policyID             : UUID;
  channel                  : String(10);
  pointsPerCurrencyUnit    : Decimal(5,2);
}

entity TierThreshold {
  key tier             : String(10);
  minLifetimePoints    : Integer;
}

annotate RewardPolicy with @assert.unique: { channel: [ channel ] };
```

- [ ] **Step 4: Write the seed CSVs**

```csv
# db/data/loyalty-Customer.csv
customerID,name,email,totalPoints,lifetimePoints,tier
b1a7e6d0-1111-4000-8000-000000000001,Alice Johnson,alice@example.com,0,0,Bronze
```

```csv
# db/data/loyalty-RewardPolicy.csv
policyID,channel,pointsPerCurrencyUnit
9f8f6f1a-2222-4000-8000-000000000001,Online,0.05
9f8f6f1a-2222-4000-8000-000000000002,Store,0.03
```

```csv
# db/data/loyalty-TierThreshold.csv
tier,minLifetimePoints
Bronze,0
Silver,5000
Gold,20000
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/schema.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add db/
git commit -m "Add domain model and seed data"
```

---

### Task 3: Service definition and role-based authorization

**Files:**
- Create: `srv/service.cds`
- Test: `test/srv/auth.test.js`

**Interfaces:**
- Consumes: `loyalty.Customer/Transaction/Redemption/RewardPolicy/TierThreshold` from Task 2.
- Produces: `LoyaltyService` at path `/odata/v4/loyalty/` with entities `Customers`, `Transactions`, `Redemptions`, `RewardPolicies`, `TierThresholds`. Later tasks' handlers register against these exact entity names via `srv.entities`.

- [ ] **Step 1: Write the failing test**

```js
// test/srv/auth.test.js
const cds = require('@sap/cds')
const test = require('node:test')
const assert = require('node:assert/strict')

const { GET } = cds.test(__dirname + '/../..')

test('anonymous requests are rejected', async () => {
  await assert.rejects(GET('/odata/v4/loyalty/Customers'), /401/)
})

test('admin can read all customers and reward policies', async () => {
  const { data } = await GET('/odata/v4/loyalty/Customers', { auth: { username: 'carol', password: '' } })
  assert.ok(data.value.length >= 1)
  const policies = await GET('/odata/v4/loyalty/RewardPolicies', { auth: { username: 'carol', password: '' } })
  assert.equal(policies.data.value.length, 2)
})

test('staff can read customers but not reward policies', async () => {
  const { data } = await GET('/odata/v4/loyalty/Customers', { auth: { username: 'bob', password: '' } })
  assert.ok(data.value.length >= 1)
  await assert.rejects(GET('/odata/v4/loyalty/RewardPolicies', { auth: { username: 'bob', password: '' } }), /403/)
})

test('customer sees only their own record and cannot read reward policies', async () => {
  const { data } = await GET('/odata/v4/loyalty/Customers', { auth: { username: 'alice', password: '' } })
  assert.equal(data.value.length, 1)
  assert.equal(data.value[0].email, 'alice@example.com')
  await assert.rejects(GET('/odata/v4/loyalty/RewardPolicies', { auth: { username: 'alice', password: '' } }), /403/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/srv/auth.test.js`
Expected: FAIL — `srv/service.cds` doesn't exist, no service to serve.

- [ ] **Step 3: Write the service definition**

```cds
// srv/service.cds
using { loyalty } from '../db/schema';

@path: '/odata/v4/loyalty'
service LoyaltyService @(requires: 'authenticated-user') {

  entity Customers      as projection on loyalty.Customer;
  entity Transactions   as projection on loyalty.Transaction;
  entity Redemptions    as projection on loyalty.Redemption;
  entity RewardPolicies as projection on loyalty.RewardPolicy;
  entity TierThresholds as projection on loyalty.TierThreshold;
}

annotate LoyaltyService.Customers with @(restrict: [
  { grant: 'READ', to: 'admin' },
  { grant: 'READ', to: 'staff' },
  { grant: 'READ', to: 'customer', where: 'email = $user.email' }
]);

annotate LoyaltyService.Transactions with @(restrict: [
  { grant: ['READ', 'CREATE'], to: 'admin' },
  { grant: ['READ', 'CREATE'], to: 'staff' },
  { grant: 'READ', to: 'customer', where: 'customerID.email = $user.email' }
]);

annotate LoyaltyService.Redemptions with @(restrict: [
  { grant: ['READ', 'CREATE'], to: 'admin' },
  { grant: ['READ', 'CREATE'], to: 'customer', where: 'customerID.email = $user.email' }
]);

annotate LoyaltyService.RewardPolicies with @(restrict: [
  { grant: '*', to: 'admin' }
]);

annotate LoyaltyService.TierThresholds with @(restrict: [
  { grant: '*', to: 'admin' }
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/srv/auth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add srv/service.cds test/srv/auth.test.js
git commit -m "Add LoyaltyService with role-based authorization"
```

---

### Task 4: Policy cache and tier computation helpers

**Files:**
- Create: `srv/lib/tier.js`
- Create: `srv/lib/policy-cache.js`
- Test: `test/lib/tier.test.js`

**Interfaces:**
- Produces: `computeTier(lifetimePoints, thresholds) => tierName:string` (pure function). `policyCache.load(srv)`, `policyCache.rateFor(channel) => number` (throws if unknown channel), `policyCache.getThresholds() => Array<{tier, minLifetimePoints}>`. Tasks 5–7 depend on these exact names.

- [ ] **Step 1: Write the failing test**

```js
// test/lib/tier.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { computeTier } = require('../../srv/lib/tier')

test('computeTier picks the highest threshold met', () => {
  const thresholds = [
    { tier: 'Bronze', minLifetimePoints: 0 },
    { tier: 'Silver', minLifetimePoints: 5000 },
    { tier: 'Gold', minLifetimePoints: 20000 }
  ]
  assert.equal(computeTier(0, thresholds), 'Bronze')
  assert.equal(computeTier(4999, thresholds), 'Bronze')
  assert.equal(computeTier(5000, thresholds), 'Silver')
  assert.equal(computeTier(19999, thresholds), 'Silver')
  assert.equal(computeTier(25000, thresholds), 'Gold')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/lib/tier.test.js`
Expected: FAIL — `srv/lib/tier.js` doesn't exist.

- [ ] **Step 3: Implement `srv/lib/tier.js`**

```js
// srv/lib/tier.js
function computeTier(lifetimePoints, thresholds) {
  const sorted = [...thresholds].sort((a, b) => b.minLifetimePoints - a.minLifetimePoints)
  const match = sorted.find(t => lifetimePoints >= t.minLifetimePoints)
  return match ? match.tier : sorted[sorted.length - 1].tier
}

module.exports = { computeTier }
```

- [ ] **Step 4: Implement `srv/lib/policy-cache.js`**

```js
// srv/lib/policy-cache.js
let policies = new Map()
let thresholds = []

async function load(srv) {
  const { RewardPolicies, TierThresholds } = srv.entities
  const rates = await srv.run(SELECT.from(RewardPolicies))
  policies = new Map(rates.map(r => [r.channel, r.pointsPerCurrencyUnit]))
  thresholds = await srv.run(SELECT.from(TierThresholds))
}

function rateFor(channel) {
  const rate = policies.get(channel)
  if (rate == null) throw new Error(`No RewardPolicy configured for channel "${channel}"`)
  return rate
}

function getThresholds() {
  return thresholds
}

module.exports = { load, rateFor, getThresholds }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/lib/tier.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add srv/lib/
git commit -m "Add tier computation and policy cache helpers"
```

---

### Task 5: Transaction handler — points computation

**Files:**
- Create: `srv/handlers/transaction.js`
- Create: `srv/service.js`
- Test: `test/srv/transaction.test.js`

**Interfaces:**
- Consumes: `policyCache.rateFor`, `policyCache.getThresholds`, `computeTier` from Task 4.
- Produces: `module.exports = (srv) => {...}` registering a `before CREATE Transactions` handler. `srv/service.js` is the file CAP auto-loads next to `srv/service.cds`; it wires all handler modules and loads the policy cache — Tasks 6–7 add their registration calls here too.

- [ ] **Step 1: Write the failing test**

```js
// test/srv/transaction.test.js
const cds = require('@sap/cds')
const test = require('node:test')
const assert = require('node:assert/strict')

const { GET, POST } = cds.test(__dirname + '/../..')
const staffAuth = { username: 'bob', password: '' }

async function demoCustomerKey() {
  const { data } = await GET('/odata/v4/loyalty/Customers', { auth: staffAuth })
  return data.value[0].customerID
}

test('an Online purchase earns points at the Online rate (0.05/₹) and updates the customer', async () => {
  const customerKey = await demoCustomerKey()

  const { data: txn } = await POST('/odata/v4/loyalty/Transactions', {
    customerID_customerID: customerKey,
    channel: 'Online',
    amount: 1000
  }, { auth: staffAuth })

  assert.equal(txn.pointsEarned, 50)

  const { data: after } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })
  assert.equal(after.totalPoints, 50)
  assert.equal(after.lifetimePoints, 50)
})

test('an invalid channel is rejected with 400', async () => {
  const customerKey = await demoCustomerKey()
  await assert.rejects(
    POST('/odata/v4/loyalty/Transactions', {
      customerID_customerID: customerKey,
      channel: 'Mail',
      amount: 100
    }, { auth: staffAuth }),
    /400/
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/srv/transaction.test.js`
Expected: FAIL — no `before CREATE` handler exists yet, so `pointsEarned`/customer totals stay at 0 and the first assertion fails.

- [ ] **Step 3: Implement `srv/handlers/transaction.js`**

```js
// srv/handlers/transaction.js
const policyCache = require('../lib/policy-cache')
const { computeTier } = require('../lib/tier')

const VALID_CHANNELS = ['Online', 'Store']

module.exports = (srv) => {
  const { Transactions, Customers } = srv.entities

  srv.before('CREATE', Transactions, async (req) => {
    const { channel, amount } = req.data
    const customerKey = req.data.customerID_customerID

    if (!VALID_CHANNELS.includes(channel)) {
      return req.reject(400, `channel must be one of ${VALID_CHANNELS.join(', ')}`, 'channel')
    }
    if (!customerKey) {
      return req.reject(400, 'customerID is required', 'customerID')
    }
    if (!(Number(amount) > 0)) {
      return req.reject(400, 'amount must be greater than 0', 'amount')
    }

    const customer = await srv.run(SELECT.one.from(Customers).where({ customerID: customerKey }))
    if (!customer) {
      return req.reject(400, `No customer found for ${customerKey}`, 'customerID')
    }

    const rate = policyCache.rateFor(channel)
    const pointsEarned = Math.floor(Number(amount) * rate)
    req.data.pointsEarned = pointsEarned
    req.data.txnDate = req.data.txnDate || new Date().toISOString()

    const newLifetimePoints = customer.lifetimePoints + pointsEarned
    const newTier = computeTier(newLifetimePoints, policyCache.getThresholds())

    await srv.run(UPDATE(Customers, customerKey).set({
      totalPoints: customer.totalPoints + pointsEarned,
      lifetimePoints: newLifetimePoints,
      tier: newTier
    }))
  })
}
```

- [ ] **Step 4: Implement `srv/service.js`**

```js
// srv/service.js
const policyCache = require('./lib/policy-cache')
const registerTransactionHandlers = require('./handlers/transaction')

module.exports = async (srv) => {
  registerTransactionHandlers(srv)
  await policyCache.load(srv)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/srv/transaction.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add srv/handlers/transaction.js srv/service.js test/srv/transaction.test.js
git commit -m "Compute pointsEarned and update customer totals on Transaction create"
```

---

### Task 6: Redemption handler — balance validation

**Files:**
- Create: `srv/handlers/redemption.js`
- Modify: `srv/service.js`
- Test: `test/srv/redemption.test.js`

**Interfaces:**
- Consumes: nothing new from earlier tasks besides `srv.entities`.
- Produces: `module.exports = (srv) => {...}` registering `before CREATE Redemptions`.

- [ ] **Step 1: Write the failing test**

```js
// test/srv/redemption.test.js
const cds = require('@sap/cds')
const test = require('node:test')
const assert = require('node:assert/strict')

const { GET, POST } = cds.test(__dirname + '/../..')
const staffAuth = { username: 'bob', password: '' }
const customerAuth = { username: 'alice', password: '' }

async function demoCustomerKey() {
  const { data } = await GET('/odata/v4/loyalty/Customers', { auth: staffAuth })
  return data.value[0].customerID
}

test('redeeming within balance succeeds and decrements totalPoints only', async () => {
  const customerKey = await demoCustomerKey()

  await POST('/odata/v4/loyalty/Transactions', {
    customerID_customerID: customerKey,
    channel: 'Store',
    amount: 10000
  }, { auth: staffAuth })

  const { data: before } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })

  await POST('/odata/v4/loyalty/Redemptions', {
    customerID_customerID: customerKey,
    pointsUsed: 100,
    remarks: '10% off coupon'
  }, { auth: customerAuth })

  const { data: after } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })
  assert.equal(after.totalPoints, before.totalPoints - 100)
  assert.equal(after.lifetimePoints, before.lifetimePoints)
  assert.equal(after.tier, before.tier)
})

test('redeeming more points than the balance is rejected with 400 and balance is unchanged', async () => {
  const customerKey = await demoCustomerKey()
  const { data: before } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })

  await assert.rejects(
    POST('/odata/v4/loyalty/Redemptions', {
      customerID_customerID: customerKey,
      pointsUsed: before.totalPoints + 1000,
      remarks: 'too many points'
    }, { auth: customerAuth }),
    /400/
  )

  const { data: after } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })
  assert.equal(after.totalPoints, before.totalPoints)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/srv/redemption.test.js`
Expected: FAIL — no validation/decrement handler exists yet.

- [ ] **Step 3: Implement `srv/handlers/redemption.js`**

```js
// srv/handlers/redemption.js
module.exports = (srv) => {
  const { Redemptions, Customers } = srv.entities

  srv.before('CREATE', Redemptions, async (req) => {
    const { pointsUsed } = req.data
    const customerKey = req.data.customerID_customerID

    if (!customerKey) {
      return req.reject(400, 'customerID is required', 'customerID')
    }
    if (!Number.isInteger(pointsUsed) || pointsUsed <= 0) {
      return req.reject(400, 'pointsUsed must be a positive integer', 'pointsUsed')
    }

    const customer = await srv.run(SELECT.one.from(Customers).where({ customerID: customerKey }))
    if (!customer) {
      return req.reject(400, `No customer found for ${customerKey}`, 'customerID')
    }
    if (customer.totalPoints < pointsUsed) {
      return req.reject(400, `Insufficient points: customer has ${customer.totalPoints}, tried to redeem ${pointsUsed}`, 'pointsUsed')
    }

    req.data.redeemDate = req.data.redeemDate || new Date().toISOString()

    await srv.run(UPDATE(Customers, customerKey).set({
      totalPoints: customer.totalPoints - pointsUsed
    }))
  })
}
```

- [ ] **Step 4: Wire it into `srv/service.js`**

```js
// srv/service.js
const policyCache = require('./lib/policy-cache')
const registerTransactionHandlers = require('./handlers/transaction')
const registerRedemptionHandlers = require('./handlers/redemption')

module.exports = async (srv) => {
  registerTransactionHandlers(srv)
  registerRedemptionHandlers(srv)
  await policyCache.load(srv)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/srv/redemption.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add srv/handlers/redemption.js srv/service.js test/srv/redemption.test.js
git commit -m "Validate and apply Redemption against customer balance"
```

---

### Task 7: RewardPolicy/TierThreshold write-through cache refresh

**Files:**
- Create: `srv/handlers/policy.js`
- Modify: `srv/service.js`
- Test: `test/srv/policy-cache.test.js`

**Interfaces:**
- Consumes: `policyCache.load` from Task 4.
- Produces: `module.exports = (srv) => {...}` registering `after CREATE/UPDATE/DELETE` on `RewardPolicies` and `TierThresholds` that reload the cache.

- [ ] **Step 1: Write the failing test**

```js
// test/srv/policy-cache.test.js
const cds = require('@sap/cds')
const test = require('node:test')
const assert = require('node:assert/strict')

const { GET, PATCH, POST } = cds.test(__dirname + '/../..')
const adminAuth = { username: 'carol', password: '' }
const staffAuth = { username: 'bob', password: '' }

test('admin updating the Online rate is immediately reflected in the next purchase\'s points, without restarting', async () => {
  const { data: policies } = await GET('/odata/v4/loyalty/RewardPolicies', { auth: adminAuth })
  const onlinePolicy = policies.value.find(p => p.channel === 'Online')

  await PATCH(`/odata/v4/loyalty/RewardPolicies/${onlinePolicy.policyID}`, {
    pointsPerCurrencyUnit: 0.10
  }, { auth: adminAuth })

  const { data: customers } = await GET('/odata/v4/loyalty/Customers', { auth: staffAuth })
  const customerKey = customers.value[0].customerID

  const { data: txn } = await POST('/odata/v4/loyalty/Transactions', {
    customerID_customerID: customerKey,
    channel: 'Online',
    amount: 1000
  }, { auth: staffAuth })

  assert.equal(txn.pointsEarned, 100)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/srv/policy-cache.test.js`
Expected: FAIL — `pointsEarned` is `50` (stale cached rate from Task 4's bootstrap load), not `100`.

- [ ] **Step 3: Implement `srv/handlers/policy.js`**

```js
// srv/handlers/policy.js
const policyCache = require('../lib/policy-cache')

module.exports = (srv) => {
  const { RewardPolicies, TierThresholds } = srv.entities

  srv.after(['CREATE', 'UPDATE', 'DELETE'], RewardPolicies, async () => {
    await policyCache.load(srv)
  })
  srv.after(['CREATE', 'UPDATE', 'DELETE'], TierThresholds, async () => {
    await policyCache.load(srv)
  })
}
```

- [ ] **Step 4: Wire it into `srv/service.js`**

```js
// srv/service.js
const policyCache = require('./lib/policy-cache')
const registerTransactionHandlers = require('./handlers/transaction')
const registerRedemptionHandlers = require('./handlers/redemption')
const registerPolicyHandlers = require('./handlers/policy')

module.exports = async (srv) => {
  registerTransactionHandlers(srv)
  registerRedemptionHandlers(srv)
  registerPolicyHandlers(srv)
  await policyCache.load(srv)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/srv/policy-cache.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add srv/handlers/policy.js srv/service.js test/srv/policy-cache.test.js
git commit -m "Write-through cache reload on RewardPolicy/TierThreshold changes"
```

---

### Task 8: Audit trail via change-tracking

**Files:**
- Create: `db/change-tracking.cds`
- Modify: `srv/service.cds`
- Test: `test/srv/change-tracking.test.js`

**Interfaces:**
- Consumes: `@cap-js/change-tracking` (installed in Task 1's `package.json`).
- Produces: a `changes` navigation association auto-added to `Customers`/`RewardPolicies`/`TierThresholds` by the `changelog.changeTracked` aspect, exposed at `/odata/v4/loyalty/Customers/<key>/changes` etc.

- [ ] **Step 1: Write the failing test**

```js
// test/srv/change-tracking.test.js
const cds = require('@sap/cds')
const test = require('node:test')
const assert = require('node:assert/strict')

const { GET, POST } = cds.test(__dirname + '/../..')
const adminAuth = { username: 'carol', password: '' }
const staffAuth = { username: 'bob', password: '' }

test('a purchase that changes totalPoints creates a Change History entry for the customer', async () => {
  const { data: customers } = await GET('/odata/v4/loyalty/Customers', { auth: staffAuth })
  const customerKey = customers.value[0].customerID

  await POST('/odata/v4/loyalty/Transactions', {
    customerID_customerID: customerKey,
    channel: 'Store',
    amount: 500
  }, { auth: staffAuth })

  const { data: changes } = await GET(`/odata/v4/loyalty/Customers/${customerKey}/changes`, { auth: adminAuth })
  assert.ok(changes.value.length >= 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test test/srv/change-tracking.test.js`
Expected: FAIL — `/changes` navigation doesn't exist (404 or similar), since `Customer` isn't change-tracked yet.

- [ ] **Step 3: Extend the domain entities with the changelog aspect**

```cds
// db/change-tracking.cds
using { sap.changelog as changelog } from '@cap-js/change-tracking';
using { loyalty } from './schema';

extend loyalty.Customer with changelog.changeTracked;
extend loyalty.RewardPolicy with changelog.changeTracked;
extend loyalty.TierThreshold with changelog.changeTracked;
```

- [ ] **Step 4: Annotate which fields are tracked, in `srv/service.cds`**

Add at the end of the file:

```cds
annotate LoyaltyService.Customers {
  totalPoints    @changelog;
  lifetimePoints @changelog;
  tier           @changelog;
};

annotate LoyaltyService.RewardPolicies {
  pointsPerCurrencyUnit @changelog;
};

annotate LoyaltyService.TierThresholds {
  minLifetimePoints @changelog;
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test test/srv/change-tracking.test.js`
Expected: PASS. If the request to `/changes` 404s, first run `node --test test/srv/change-tracking.test.js` with `console.log` of the raw response to inspect the actual generated navigation/entity name from `@cap-js/change-tracking` in your installed version, and adjust the URL in the test to match — the field names shown here (`changes`) match the plugin's documented Node.js convention but should be empirically confirmed against your installed version before treating this step as done.

- [ ] **Step 6: Commit**

```bash
git add db/change-tracking.cds srv/service.cds test/srv/change-tracking.test.js
git commit -m "Add DB-backed audit trail via @cap-js/change-tracking"
```

---

### Task 9: Fiori Elements UI — Customer app

**Files:**
- Create: `srv/ui-annotations.cds`
- Create: `app/customers-app/` (generated)

**Interfaces:**
- Consumes: `LoyaltyService.Customers` (with `changes`, `transactions`-style navigation via the `customerID` backlink) from Tasks 3 and 8.

- [ ] **Step 1: Write UI annotations for Customer, Transaction, Redemption**

```cds
// srv/ui-annotations.cds
using { LoyaltyService } from './service';

annotate LoyaltyService.Customers with @(
  UI: {
    HeaderInfo: {
      TypeName: 'Customer', TypeNamePlural: 'Customers',
      Title: { Value: name }
    },
    LineItem: [
      { Value: name }, { Value: email }, { Value: totalPoints }, { Value: lifetimePoints }, { Value: tier }
    ],
    Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'Purchases', Target: 'transactions/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Redemptions', Target: 'redemptions/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' }
    ]
  }
) {
  customerID @UI.Hidden;
};

annotate LoyaltyService.Transactions with @(
  UI.LineItem: [
    { Value: txnDate }, { Value: channel }, { Value: amount }, { Value: pointsEarned }
  ]
);

annotate LoyaltyService.Redemptions with @(
  UI.LineItem: [
    { Value: redeemDate }, { Value: pointsUsed }, { Value: remarks }
  ]
);
```

Add the corresponding backlink associations so the facets above resolve — modify `db/schema.cds`:

```cds
// in entity Customer, add:
  transactions : Association to many Transaction on transactions.customerID = $self;
  redemptions  : Association to many Redemption on redemptions.customerID = $self;
```

- [ ] **Step 2: Reference the annotations file from the service**

Add to the top of `srv/service.cds`, after the existing `using` line:

```cds
using from './ui-annotations';
```

- [ ] **Step 3: Verify the model still compiles**

Run: `npx cds compile srv/service.cds --to edmx > /dev/null`
Expected: no errors.

- [ ] **Step 4: Generate the Fiori Elements app**

First load the tool schema (mandatory per the sap-fiori-mcp-server's own protocol): call `ToolSearch` with `select:mcp__plugin_sap-fiori-mcp-server_fiori-mcp__generate_fiori_app_cap`. Then call it with:
- `floorplan`: `FE_LROP`
- `project.name`: `customers-app`, `project.targetFolder`: absolute path to this repo root, `project.title`: `Customer Loyalty`
- `service.servicePath`: `/odata/v4/loyalty/`
- `service.capService.projectPath`: absolute path to this repo root, `service.capService.serviceName`: `LoyaltyService`, `service.capService.serviceCdsPath`: `srv/service.cds`, `service.capService.capType`: `Node.js`
- `entityConfig.mainEntity.entityName`: `Customers`, `generateLROPAnnotations`: `true`, `generateFormAnnotations`: `true`

Expected: `app/customers-app/webapp/manifest.json` is created referencing `LoyaltyService`/`Customers`.

- [ ] **Step 5: Smoke-test the app**

Run: `npx cds watch` in one terminal, then in another: `curl -u carol: http://localhost:4004/odata/v4/loyalty/Customers`
Expected: 200 with the seeded Alice Johnson record. Also open `http://localhost:4004/customers-app/webapp/index.html` (or the URL `cds watch` prints for the app) in a browser and confirm the List Report renders.

- [ ] **Step 6: Commit**

```bash
git add srv/ui-annotations.cds srv/service.cds db/schema.cds app/customers-app/
git commit -m "Add Customer Fiori Elements app with Transactions/Redemptions/Change History facets"
```

---

### Task 10: Fiori Elements UI — Staff Transactions app

**Files:**
- Modify: `srv/ui-annotations.cds`
- Create: `app/transactions-app/` (generated)

**Interfaces:**
- Consumes: `LoyaltyService.Transactions` from Task 3, value-help into `Customers` for staff to pick a customer.

- [ ] **Step 1: Add value-help annotation so staff can search a customer by name/email**

Add to `srv/ui-annotations.cds`:

```cds
annotate LoyaltyService.Transactions with {
  customerID @(
    Common: {
      Text: customerID.name,
      TextArrangement: #TextOnly,
      ValueList: {
        Label: 'Customers',
        CollectionPath: 'Customers',
        Parameters: [
          { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: customerID_customerID, ValueListProperty: 'customerID' },
          { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
          { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'email' }
        ]
      }
    }
  )
};
```

- [ ] **Step 2: Verify the model still compiles**

Run: `npx cds compile srv/service.cds --to edmx > /dev/null`
Expected: no errors.

- [ ] **Step 3: Generate the Fiori Elements app**

Same tool as Task 9, Step 4, with:
- `project.name`: `transactions-app`, `project.title`: `Record Purchase`
- `entityConfig.mainEntity.entityName`: `Transactions`

Expected: `app/transactions-app/webapp/manifest.json` created referencing `LoyaltyService`/`Transactions`.

- [ ] **Step 4: Smoke-test as staff**

Run: `npx cds watch`, then `curl -u bob: http://localhost:4004/odata/v4/loyalty/Transactions`
Expected: 200. Open the app's URL and confirm the customer field on the create form shows the value-help search.

- [ ] **Step 5: Commit**

```bash
git add srv/ui-annotations.cds app/transactions-app/
git commit -m "Add staff-facing Transactions Fiori Elements app with customer search"
```

---

### Task 11: Fiori Elements UI — Admin RewardPolicy/TierThreshold apps

**Files:**
- Modify: `srv/ui-annotations.cds`
- Create: `app/reward-policy-app/` (generated)
- Create: `app/tier-threshold-app/` (generated)

**Interfaces:**
- Consumes: `LoyaltyService.RewardPolicies`/`TierThresholds` from Task 3.

- [ ] **Step 1: Add UI annotations**

Add to `srv/ui-annotations.cds`:

```cds
annotate LoyaltyService.RewardPolicies with @(
  UI: {
    HeaderInfo: { TypeName: 'Reward Policy', TypeNamePlural: 'Reward Policies', Title: { Value: channel } },
    LineItem: [ { Value: channel }, { Value: pointsPerCurrencyUnit } ],
    Facets: [ { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' } ]
  }
) {
  policyID @UI.Hidden;
};

annotate LoyaltyService.TierThresholds with @(
  UI: {
    HeaderInfo: { TypeName: 'Tier Threshold', TypeNamePlural: 'Tier Thresholds', Title: { Value: tier } },
    LineItem: [ { Value: tier }, { Value: minLifetimePoints } ],
    Facets: [ { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' } ]
  }
);
```

- [ ] **Step 2: Verify the model still compiles**

Run: `npx cds compile srv/service.cds --to edmx > /dev/null`
Expected: no errors.

- [ ] **Step 3: Generate both Fiori Elements apps**

Same tool as Task 9 Step 4, called twice:
- `project.name`: `reward-policy-app`, `entityConfig.mainEntity.entityName`: `RewardPolicies`
- `project.name`: `tier-threshold-app`, `entityConfig.mainEntity.entityName`: `TierThresholds`

Expected: both `app/reward-policy-app/webapp/manifest.json` and `app/tier-threshold-app/webapp/manifest.json` created.

- [ ] **Step 4: Smoke-test as admin, and confirm staff/customer are blocked**

Run: `npx cds watch`, then:
- `curl -u carol: http://localhost:4004/odata/v4/loyalty/RewardPolicies` → 200
- `curl -u bob: http://localhost:4004/odata/v4/loyalty/RewardPolicies` → 403
- `curl -u alice: http://localhost:4004/odata/v4/loyalty/RewardPolicies` → 403

- [ ] **Step 5: Commit**

```bash
git add srv/ui-annotations.cds app/reward-policy-app/ app/tier-threshold-app/
git commit -m "Add admin-only RewardPolicy/TierThreshold Fiori Elements apps"
```

---

### Task 12: XSUAA, Approuter, HTML5 repo, and MTA wiring

**Files:**
- Create: `xs-security.json`
- Create: `mta.yaml`
- Create: `app/router/` (via `cds add approuter`)

**Interfaces:**
- Produces: role-templates `customer`, `staff`, `admin` in `xs-security.json`, mapped to CAP's `@requires`/`@restrict` role names used since Task 3; role-collections in `mta.yaml` an admin assigns to real BTP users after deployment.

- [ ] **Step 1: Add the XSUAA, HTML5-repo, approuter, and MTA facets**

Run, in order:
```bash
npx cds add xsuaa --for production
npx cds add html5-repo --for production
npx cds add approuter
npx cds add mta
```
Expected: `xs-security.json`, `mta.yaml`, and `app/router/` are created/updated with no errors.

- [ ] **Step 2: Replace the generated `xs-security.json` scopes/role-templates with the three app roles**

```json
{
  "xsappname": "loyalty-rewards",
  "tenant-mode": "dedicated",
  "scopes": [
    { "name": "$XSAPPNAME.customer", "description": "Customer — view own points and history, redeem points" },
    { "name": "$XSAPPNAME.staff", "description": "Retail Staff — record purchases" },
    { "name": "$XSAPPNAME.admin", "description": "Admin — manage reward policies and tier thresholds" }
  ],
  "attributes": [
    { "name": "email", "description": "Email used to match a Customer record", "valueType": "s" }
  ],
  "role-templates": [
    { "name": "customer", "description": "Customer", "scope-references": ["$XSAPPNAME.customer"], "attribute-references": [{ "name": "email" }] },
    { "name": "staff", "description": "Retail Staff", "scope-references": ["$XSAPPNAME.staff"] },
    { "name": "admin", "description": "Admin", "scope-references": ["$XSAPPNAME.admin"] }
  ]
}
```

- [ ] **Step 3: Add role-collections in `mta.yaml`'s xsuaa resource**

Find the `resources:` entry with `service: xsuaa` and add under its `parameters.config`:

```yaml
        role-collections:
          - name: 'Loyalty-Customer (${space})'
            description: 'Loyalty program customer'
            role-template-references:
              - '$XSAPPNAME.customer'
          - name: 'Loyalty-Staff (${space})'
            description: 'Retail staff'
            role-template-references:
              - '$XSAPPNAME.staff'
          - name: 'Loyalty-Admin (${space})'
            description: 'Loyalty program admin'
            role-template-references:
              - '$XSAPPNAME.admin'
```

- [ ] **Step 4: Sanity-check the generated files**

Run: `node -e "JSON.parse(require('fs').readFileSync('xs-security.json','utf8')); console.log('xs-security.json is valid JSON')"`
Expected: prints the success message with no error.

Run: `npx js-yaml mta.yaml > /dev/null && echo "mta.yaml is valid YAML"` (if `js-yaml` isn't available, `npx --yes js-yaml mta.yaml` will fetch it once)
Expected: prints the success message with no error.

Note: full `mbt build`/`cf deploy` validation isn't possible in this environment (no `mbt`/`cf` CLI here) — that happens in Task 14/your BAS+BTP environment, per our earlier agreement that you own the actual deployment.

- [ ] **Step 5: Commit**

```bash
git add xs-security.json mta.yaml app/router/ package.json
git commit -m "Add XSUAA roles, approuter, and MTA deployment config"
```

---

### Task 13: Documentation deliverables

**Files:**
- Create: `docs/01-project-overview.md`
- Create: `docs/02-data-model.md`
- Create: `docs/03-sprint-plan.md`
- Create: `docs/04-test-cases.md`
- Create: `docs/05-deployment-steps.md`
- Create: `docs/06-build-code-prompts.md`

- [ ] **Step 1: `docs/01-project-overview.md`**

```markdown
# Project Overview — Retail Omni-Channel Customer Loyalty & Rewards Management

## Objective
Develop a Loyalty and Rewards Management System that integrates online and in-store customer
transactions, computes loyalty points dynamically per channel, and allows redemption through
multiple channels while ensuring a customer's point balance never goes negative.

## Scope
- Three roles: Customer (view points, redeem, track history), Retail Staff (record purchases,
  POS or Online), Admin (define/modify reward policies and tier thresholds).
- Single CAP (Node.js) service, single deployable MTA, SAP HANA Cloud in production.
- Three Fiori Elements apps: Customer self-service, Staff purchase entry, Admin policy config.
- DB-backed audit trail of point/policy changes via `@cap-js/change-tracking`.

## High-Level Flow

```
Retail Staff records a purchase (channel: Online/Store, amount)
        │
        ▼
Transaction.before(CREATE) handler
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
Redemption.before(CREATE) handler
  - rejects if pointsUsed > Customer.totalPoints
  - on success, decrements Customer.totalPoints only (lifetimePoints/tier untouched)
        │
        ▼
Admin edits RewardPolicy/TierThreshold via the Admin app
  - DB row updated, then the in-memory policy cache is reloaded (write-through)
  - every change is recorded to the DB-backed Change History
```
```

- [ ] **Step 2: `docs/02-data-model.md`**

```markdown
# Data Model

## Customer
| Attribute | Type | Key | Description |
|---|---|---|---|
| customerID | UUID | ✓ | Unique identifier |
| name | String | | Full name |
| email | String | | Email address; also used to match the authenticated user to their own record |
| totalPoints | Integer | | Spendable balance — decremented by redemption, must stay ≥ 0 |
| lifetimePoints | Integer | | Cumulative points ever earned — never decremented; drives `tier` (added beyond the source spec: prevents a full redemption from instantly demoting tier) |
| tier | String | | Bronze/Silver/Gold, derived from lifetimePoints |

## Transaction
| Attribute | Type | Key | Description |
|---|---|---|---|
| txnID | UUID | ✓ | Unique identifier |
| customerID | Association to Customer | | Links to the purchasing customer |
| channel | String | | "Online" or "Store" |
| amount | Decimal(10,2) | | Purchase amount |
| txnDate | DateTime | | When the purchase occurred |
| pointsEarned | Integer | | Computed by the Transaction handler from the channel's RewardPolicy rate |

## Redemption
| Attribute | Type | Key | Description |
|---|---|---|---|
| redeemID | UUID | ✓ | Unique identifier |
| customerID | Association to Customer | | Links to the redeeming customer |
| pointsUsed | Integer | | Points redeemed; validated against totalPoints |
| redeemDate | DateTime | | When the redemption occurred |
| remarks | String | | Reward item/offer details |

## RewardPolicy (added — fills a gap in the source spec)
| Attribute | Type | Key | Description |
|---|---|---|---|
| policyID | UUID | ✓ | Unique identifier |
| channel | String, unique | | "Online" or "Store" |
| pointsPerCurrencyUnit | Decimal(5,2) | | Admin-editable rate; seeded Online=0.05, Store=0.03 |

## TierThreshold (added — same reason)
| Attribute | Type | Key | Description |
|---|---|---|---|
| tier | String | ✓ | Bronze/Silver/Gold |
| minLifetimePoints | Integer | | Minimum lifetimePoints to reach this tier; seeded 0/5000/20000 |

## Relationships
- `Customer 1 — * Transaction` via `Transaction.customerID`
- `Customer 1 — * Redemption` via `Redemption.customerID`
- `RewardPolicy`/`TierThreshold` are standalone admin-managed config, referenced by the
  Transaction handler through an in-memory write-through cache (not a direct DB association).
```

- [ ] **Step 3: `docs/03-sprint-plan.md`**

```markdown
# Agile Sprint Plan

## Sprint 1 — Entity model, mock data, service definitions
**User stories:**
- As a developer, I need the Customer/Transaction/Redemption/RewardPolicy/TierThreshold entities
  modeled in CDS so the rest of the system has a persistence layer.
  *Acceptance criteria:* `db/schema.cds` compiles; seed CSVs load 2 reward policies, 3 tier
  thresholds, 1 demo customer (verified by `test/schema.test.js`).
- As an admin/staff/customer, I need role-scoped access to the service so each role only sees
  what they're allowed to.
  *Acceptance criteria:* `test/srv/auth.test.js` passes for all three roles plus anonymous 401.

## Sprint 2 — Point computation & redemption logic
**User stories:**
- As Retail Staff, when I record a purchase, points are computed automatically from the
  channel's current rate. *Acceptance criteria:* `test/srv/transaction.test.js` passes.
- As a Customer, I cannot redeem more points than I have. *Acceptance criteria:*
  `test/srv/redemption.test.js` passes (success + over-redemption rejection cases).
- As an Admin, changing a reward policy rate takes effect on the very next purchase, without
  redeploying. *Acceptance criteria:* `test/srv/policy-cache.test.js` passes.

## Sprint 3 — Fiori dashboard for customer, staff, and admin
**User stories:**
- As a Customer, I can view my points/tier and purchase/redemption history in one app.
  *Acceptance criteria:* Customer Fiori app (Task 9) renders List Report + Object Page with
  Transactions/Redemptions/Change History facets.
- As Retail Staff, I can record a purchase against a searched customer directly.
  *Acceptance criteria:* Staff Transactions app (Task 10) with customer value-help.
- As an Admin, I can view and edit reward policies and tier thresholds, and see their change
  history. *Acceptance criteria:* Admin apps (Task 11), 403 confirmed for non-admin roles.

## Sprint 4 — Deployment & system testing
**User stories:**
- As a developer, I have a step-by-step guide to deploy this single MTA to Cloud Foundry.
  *Acceptance criteria:* `docs/05-deployment-steps.md`, `xs-security.json`/`mta.yaml` validated
  (Task 12).
- As a QA reviewer, I have a test case sheet covering CRUD, points logic, and redemption
  validation. *Acceptance criteria:* `docs/04-test-cases.md` (this deliverable), full `npm test`
  suite green (Task 14).
```

- [ ] **Step 4: `docs/04-test-cases.md`**

```markdown
# Test Case Sheet

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
2. Expect a 400/409 rejection referencing the `channel` uniqueness constraint.
```

- [ ] **Step 5: `docs/05-deployment-steps.md`**

```markdown
# Deployment Steps — BAS → Build Code → Cloud Foundry

## 1. Bring this project into your BAS dev space
You already created a `loyalty-rewards` project in BAS via "Create a new project with
template" → CAP → Node.js → PostgreSQL (local) → Cloud Foundry: MTA Deployment → XSUAA +
Approuter + HTML5 App Repository → Extended Sample with UI. This plan's project mirrors those
same choices so the two can be merged:
1. Push this repository to a git remote you control (GitHub/GitLab).
2. In your BAS dev space terminal, inside the existing `loyalty-rewards` project folder:
   `git remote add plan <your-remote-url> && git fetch plan`
3. Replace the generated sample content with this plan's `db/`, `srv/`, `app/`, `xs-security.json`,
   `mta.yaml`, and `package.json` — either `git checkout plan/main -- db srv app xs-security.json mta.yaml package.json`
   or copy the files manually via the BAS file explorer.
4. `npm install` again inside BAS to pick up the added dependencies.

## 2. Local verification in BAS
```bash
cds watch
```
Confirm the service starts, the seeded RewardPolicy/TierThreshold/Customer rows are visible via
`GET /odata/v4/loyalty/Customers`, and each of the three Fiori apps opens and renders.

## 3. Bind to your real HANA Cloud instance for a hybrid test (optional but recommended)
```bash
cds bind -2 <your-hana-service-instance-name>
cds watch --profile hybrid
```
This runs the app locally against your actual SAP BTP trial HANA Cloud database instance before
a full cloud deployment — catches HANA-specific issues early.

## 4. Build and deploy the MTA to Cloud Foundry
```bash
cf login --sso
cf target                      # verify the correct org/space
mbt build -t gen --mtar mta.tar
cf deploy gen/mta.tar -f
```
The final log line prints the Approuter URL — that's your application's entry point.

## 5. Assign role-collections to your user
In the BTP Cockpit → Security → Role Collections, find `Loyalty-Customer (<space>)`,
`Loyalty-Staff (<space>)`, `Loyalty-Admin (<space>)` (created by Task 12's `mta.yaml`) and assign
the ones you need to your BTP user (or test users) so you can log in as each role and demonstrate
the three Fiori apps end-to-end.

## 6. Capture evidence
Screenshot: the running Approuter URL, each of the three Fiori apps with real data, and a
`GET .../Customers/{id}/changes` response showing an audit trail entry — this is the "executed to
display the output" evidence the source assessment's Important Note requires.
```

- [ ] **Step 6: `docs/06-build-code-prompts.md`**

```markdown
# Build Code Prompts

This session doesn't have live access to SAP Build Code's cloud UI (Joule), so the actual CAP
project was hand-built here and verified with `cds watch` + automated tests. The prompts below
are what you'd give Build Code's Joule-powered generative development assistant, in your own BTP
subaccount, to (re)produce or extend each artifact — run these there to get the actual "executed
in Build Code" evidence the assessment's Important Note asks for.

1. **Entities:** "Create a CAP data model with a Customer entity (customerID UUID key, name,
   email, totalPoints integer, lifetimePoints integer, tier string), a Transaction entity
   (txnID UUID key, customerID association to Customer, channel string, amount decimal(10,2),
   txnDate datetime, pointsEarned integer), and a Redemption entity (redeemID UUID key,
   customerID association to Customer, pointsUsed integer, redeemDate datetime, remarks
   string)."
2. **Reward policy config:** "Add a RewardPolicy entity (policyID UUID key, channel string
   unique, pointsPerCurrencyUnit decimal(5,2)) and a TierThreshold entity (tier string key,
   minLifetimePoints integer), seeded with Online=0.05, Store=0.03, and Bronze=0/Silver=5000/
   Gold=20000."
3. **Service + roles:** "Expose all five entities in a LoyaltyService at path
   /odata/v4/loyalty. Restrict RewardPolicy and TierThreshold to the admin role only. Let staff
   create Transactions. Let customers read and create their own Redemptions, matched by
   email."
4. **Points handler:** "Add a before-CREATE handler on Transactions that computes
   pointsEarned from the channel's RewardPolicy rate, and increments the linked Customer's
   totalPoints and lifetimePoints."
5. **Redemption handler:** "Add a before-CREATE handler on Redemptions that rejects the
   request with a 400 if pointsUsed exceeds the customer's totalPoints, otherwise decrements
   totalPoints only."
6. **Audit trail:** "Add the @cap-js/change-tracking plugin and track changes to Customer's
   totalPoints, lifetimePoints, and tier, and to RewardPolicy/TierThreshold's rate/threshold
   fields."
7. **Fiori UI:** "Generate a List Report Object Page Fiori Elements app for Customers with
   Transactions and Redemptions shown as facets on the object page, plus a Change History
   facet."
```

- [ ] **Step 7: Commit**

```bash
git add docs/01-project-overview.md docs/02-data-model.md docs/03-sprint-plan.md docs/04-test-cases.md docs/05-deployment-steps.md docs/06-build-code-prompts.md
git commit -m "Write project overview, data model, sprint plan, test cases, deployment, and Build Code prompt docs"
```

---

### Task 14: Final verification pass

**Files:** none created — verification only.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: all tests across `test/schema.test.js`, `test/lib/tier.test.js`, `test/srv/auth.test.js`, `test/srv/transaction.test.js`, `test/srv/redemption.test.js`, `test/srv/policy-cache.test.js`, `test/srv/change-tracking.test.js` pass.

- [ ] **Step 2: Full local smoke test**

Run: `npx cds watch`
Expected: server starts with no errors, logs show the `mocked` auth strategy and the three role-restricted service entities. Manually exercise:
- `curl -u carol: http://localhost:4004/odata/v4/loyalty/Customers`
- `curl -u bob: http://localhost:4004/odata/v4/loyalty/Transactions`
- Open each of the three Fiori app URLs in a browser and confirm they render real data.

- [ ] **Step 3: Cross-check against the source PDF's Expected Deliverables table**

Confirm each row has a concrete artifact:
- Project Overview Document → `docs/01-project-overview.md` ✓
- Data Model Design → `docs/02-data-model.md` ✓
- Service Definition → `srv/service.cds` ✓
- Agile Sprint Plan → `docs/03-sprint-plan.md` ✓
- Test Case Sheet → `docs/04-test-cases.md` ✓
- Deployment Steps → `docs/05-deployment-steps.md` ✓
- Important Note (BAS + Build Code, prompts submitted, app executed) → `docs/06-build-code-prompts.md` + Task 14 Step 2's smoke test evidence, plus the actual BAS/CF deployment you perform per `docs/05-deployment-steps.md` ✓

- [ ] **Step 4: Final commit**

```bash
git add -A
git status   # confirm nothing unexpected is staged
git commit -m "Final verification pass" --allow-empty
```
