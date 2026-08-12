const cds = require('@sap/cds')
const policyCache = require('./lib/policy-cache')
const registerTransactionHandlers = require('./handlers/transaction')

module.exports = (srv) => {
  registerTransactionHandlers(srv)

  cds.on('served', async () => {
    await policyCache.load(srv)
  })
}
