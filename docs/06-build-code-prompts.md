# Build Code Prompts

This session doesn't have live access to SAP Build Code's cloud UI (Joule), so the actual CAP
project was hand-built here — in BAS-equivalent local development, backed by real `cds compile`,
`cds watch`, and an automated test suite (12/12 passing) — rather than through Build Code's
generative chat interface. The prompts below are what you'd give Build Code's Joule-powered
assistant, in your own BTP subaccount, to (re)produce or extend each artifact — run these there
to get the actual "executed in Build Code" evidence the assessment's Important Note asks for,
and submit this file alongside it as your prompt log.

1. **Entities:** "Create a CAP data model with a Customer entity (customerID UUID key, name,
   email, totalPoints integer, lifetimePoints integer, tier string, plus associations to
   Transaction and Redemption), a Transaction entity (txnID UUID key, customerID association to
   Customer, channel string, amount decimal(10,2), txnDate datetime, pointsEarned integer), and a
   Redemption entity (redeemID UUID key, customerID association to Customer, pointsUsed integer,
   redeemDate datetime, remarks string)."
2. **Reward policy config:** "Add a RewardPolicy entity (policyID UUID key, channel string
   unique, pointsPerCurrencyUnit decimal(5,2)) and a TierThreshold entity (tier string key,
   minLifetimePoints integer), seeded with Online=0.05, Store=0.03, and Bronze=0/Silver=5000/
   Gold=20000."
3. **Service + roles:** "Expose all five entities in a LoyaltyService at path
   /odata/v4/loyalty. Restrict RewardPolicy and TierThreshold to the admin role only. Let staff
   read customers and create Transactions. Let customers read and create their own Redemptions
   and their own Customer/Transaction records, matched by email against the logged-in user."
4. **Points handler:** "Add a before-CREATE handler on Transactions that validates the channel
   is Online or Store, computes pointsEarned from the channel's RewardPolicy rate
   (floor(amount × rate)), and increments the linked Customer's totalPoints and lifetimePoints,
   recomputing tier from lifetimePoints against the TierThreshold rows."
5. **Redemption handler:** "Add a before-CREATE handler on Redemptions that rejects the
   request with a 400 if pointsUsed exceeds the customer's totalPoints, otherwise decrements
   totalPoints only — leave lifetimePoints and tier unchanged so a full redemption never demotes
   a customer's tier."
6. **Live policy cache:** "Cache RewardPolicy and TierThreshold rows in memory on service
   startup, and reload the cache whenever an admin creates, updates, or deletes a RewardPolicy or
   TierThreshold row, so rate changes take effect on the very next purchase without a restart."
7. **Audit trail:** "Add the @cap-js/change-tracking plugin and track changes to Customer's
   totalPoints, lifetimePoints, and tier, and to RewardPolicy/TierThreshold's rate/threshold
   fields."
8. **Fiori UI — customer:** "Generate a List Report Object Page Fiori Elements app for
   Customers with Transactions and Redemptions shown as facets on the object page, plus a Change
   History facet."
9. **Fiori UI — staff:** "Generate a List Report Object Page Fiori Elements app for
   Transactions with a value-help on the customer field showing name and email."
10. **Fiori UI — admin:** "Generate List Report Object Page Fiori Elements apps for
    RewardPolicies and for TierThresholds, each with a Change History facet."
11. **Deployment:** "Add XSUAA authentication with role-templates matching my CDS model's
    roles, an HTML5 App Repository, an Approuter, and an MTA descriptor bundling all of my Fiori
    apps, the CAP service, and the HANA database as a single deployable unit."
