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
