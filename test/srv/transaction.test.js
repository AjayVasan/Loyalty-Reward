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

test('the created Transaction carries managed createdBy/createdAt', async () => {
  const customerKey = await demoCustomerKey()

  const { data: txn } = await POST('/odata/v4/loyalty/Transactions', {
    customerID_customerID: customerKey,
    channel: 'Online',
    amount: 200
  }, { auth: staffAuth })

  assert.equal(txn.createdBy, 'bob')
  assert.ok(txn.createdAt)
})

test('a Transaction updates the linked Customer\'s managed modifiedAt/modifiedBy, even via the bare UPDATE', async () => {
  const customerKey = await demoCustomerKey()
  const { data: before } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })

  await POST('/odata/v4/loyalty/Transactions', {
    customerID_customerID: customerKey,
    channel: 'Online',
    amount: 300
  }, { auth: staffAuth })

  const { data: after } = await GET(`/odata/v4/loyalty/Customers/${customerKey}`, { auth: staffAuth })
  // srv/handlers/transaction.js updates Customer via a bare UPDATE straight to cds.db (to
  // avoid the nested-transaction deadlock and to bypass @restrict — see the comment there).
  // `managed`'s createdAt/modifiedAt population is a lower-level, persistence-layer concern
  // (@cds.on.insert/@cds.on.update), not an ApplicationService-only generic handler, so it
  // still fires here even though @restrict does not.
  assert.notEqual(after.modifiedAt, before.modifiedAt)
  assert.equal(after.modifiedBy, 'bob')
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
