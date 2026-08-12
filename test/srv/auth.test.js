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
