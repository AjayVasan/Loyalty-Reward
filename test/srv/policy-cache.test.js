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
