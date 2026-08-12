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
