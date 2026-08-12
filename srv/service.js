const cds = require('@sap/cds')
const policyCache = require('./lib/policy-cache')
const registerTransactionHandlers = require('./handlers/transaction')
const registerRedemptionHandlers = require('./handlers/redemption')

module.exports = (srv) => {
  registerTransactionHandlers(srv)
  registerRedemptionHandlers(srv)

  cds.on('served', async () => {
    await policyCache.load(srv)
  })
}
