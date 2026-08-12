const policyCache = require('../lib/policy-cache')

module.exports = (srv) => {
  const { RewardPolicies, TierThresholds } = srv.entities

  srv.after(['CREATE', 'UPDATE', 'DELETE'], RewardPolicies, async () => {
    await policyCache.load(srv)
  })
  srv.after(['CREATE', 'UPDATE', 'DELETE'], TierThresholds, async () => {
    await policyCache.load(srv)
  })
}
