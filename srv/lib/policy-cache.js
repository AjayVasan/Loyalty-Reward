let policies = new Map()
let thresholds = []

async function load(srv) {
  const { RewardPolicies, TierThresholds } = srv.entities
  const rates = await srv.run(SELECT.from(RewardPolicies))
  policies = new Map(rates.map(r => [r.channel, r.pointsPerCurrencyUnit]))
  thresholds = await srv.run(SELECT.from(TierThresholds))
}

function rateFor(channel) {
  const rate = policies.get(channel)
  if (rate == null) throw new Error(`No RewardPolicy configured for channel "${channel}"`)
  return rate
}

function getThresholds() {
  return thresholds
}

module.exports = { load, rateFor, getThresholds }
