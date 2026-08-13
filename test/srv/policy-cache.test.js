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

test('admin creating a RewardPolicy with an invalid channel is rejected with 400', async () => {
  await assert.rejects(
    POST('/odata/v4/loyalty/RewardPolicies', {
      channel: 'Marketplace', pointsPerCurrencyUnit: 0.01
    }, { auth: adminAuth }),
    /400/
  )
})

test('admin can define a new tier in TierThreshold beyond Bronze/Silver/Gold (deliberately not an enum)', async () => {
  const { data: platinum } = await POST('/odata/v4/loyalty/TierThresholds', {
    tier: 'Platinum', minLifetimePoints: 50000
  }, { auth: adminAuth })

  assert.equal(platinum.tier, 'Platinum')
})
