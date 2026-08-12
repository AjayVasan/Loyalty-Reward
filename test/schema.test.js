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
