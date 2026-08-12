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
