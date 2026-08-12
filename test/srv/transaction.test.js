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
