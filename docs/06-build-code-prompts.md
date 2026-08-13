# Build Code Prompts

This session doesn't have live access to SAP Build Code's cloud UI (Joule), so the actual CAP
project was hand-built here — in BAS-equivalent local development, backed by real `cds compile`,
`cds watch`, and an automated test suite (16/16 passing) — rather than through Build Code's
generative chat interface. Section A below is what you'd actually paste into Joule's command
palette in your BAS dev space to reproduce or extend the four Fiori apps — that's the part of this
project Joule's slash commands genuinely cover. Section B is honest about the part they don't:
the CDS data model, service, and business-logic handlers were written directly as code, and there
is no slash command in the current Joule palette for generating any of that. Run Section A's
prompts in your subaccount to get the actual "executed in Build Code" evidence the assessment's
Important Note asks for; submit this file alongside it as your prompt log.

## A. UI generation — real Joule slash-command prompts

All four Fiori apps in `app/` were generated the same way this reproduces them: through
`/fiori-gen-cap-ui` ("Generate SAP Fiori Elements UI from Storyboard"), which builds the app
straight from your running CAP service and drops it directly into the project. That command's
one hard prerequisite is an **uploaded attachment** — a storyboard/wireframe image — alongside the
text; text alone isn't enough for it to run. A rough hand sketch of the list columns and the
object-page facets you want is enough, it doesn't need to be polished.

Each prompt below is exactly what you'd type — start every one with `/fiori-gen-cap-ui` on its
own, attach a wireframe, then write the rest as a normal message.

---

**1. Customers app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the Customers entity from LoyaltyService. List page
columns: name, email, totalPoints, lifetimePoints, tier. On the object page I want three facets:
one showing the customer's purchases (that's the transactions navigation), one showing their
redemptions, and one called "Change History" showing the changes navigation. Hide the customerID
field everywhere, nobody needs to see a raw UUID.
```

**2. Transactions app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the Transactions entity from LoyaltyService. List
columns: txnDate, channel, amount, pointsEarned. The customer field on this entity needs a
value-help dropdown that searches by name and email, not a raw ID picker — wire it up as a
ValueList against Customers so staff can just type a customer's name when logging a purchase.
```

**3. Reward Policy app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the RewardPolicies entity from LoyaltyService. List
columns: channel, pointsPerCurrencyUnit. Add a "Change History" facet on the object page so admins
can see the history of rate changes. Hide policyID, it's just an internal key.
```

**4. Tier Threshold app**

```
/fiori-gen-cap-ui
Build me a List Report Object Page app on the TierThresholds entity from LoyaltyService. List
columns: tier, minLifetimePoints. Add a "Change History" facet on the object page, same as the
reward policy app, so admins can see when tier boundaries were last edited.
```

---

If `/fiori-gen-cap-ui` isn't in your palette variant, `/add-ui` ("Generate UI for SAP Fiori and
mobile applications... from the Storyboard and Joule panel") is the broader command it's built on
and takes the same kind of prompt+attachment — use that instead.

## B. Everything else — not a slash-command flow, and that's fine

The data model, the service definition with its role-based `@restrict` rules, the two write
handlers (`transaction.js`, `redemption.js`), the write-through policy cache, and the
`@cap-js/change-tracking` audit wiring were all written directly in `db/schema.cds`, `srv/*.cds`,
and `srv/handlers/*.js`. None of the commands in the current Joule palette (`/add-ui`,
`/code-search`, `/fiori-gen-cap-ui`, `/fiori-gen-spec-app`, `/hana-ai`,
`/hana-expression-generation`, `/hana-gen`, `/hana-modeling-help`, `/hana-sql-gen`, `/hdi-gen`,
`/sap-help`, `/ui5`, `/ui5-adp-ext`, `/ui5-create-app`, `/ui5-create-page`, `/ui5-typescript`)
actually generates a CAP entity, a service, or business-logic handlers — they're scoped to Fiori
UI generation, HANA SQL/modeling/HDI artifacts, SAPUI5-specific work, and doc/code search.
Forcing one of those commands onto this work would produce something disconnected from what's
actually in the repo, so this section stays plain-English — describe it to Joule's free-form
"Ask a question" chat (no `/` prefix) if you want AI assistance while typing it, or just write the
code, which is what actually happened here:

1. **Entities:** A CAP data model with a Customer entity (customerID UUID key, name, email,
   totalPoints integer, lifetimePoints integer, tier string, plus associations to Transaction and
   Redemption), a Transaction entity (txnID UUID key, customerID association to Customer, channel
   string, amount decimal(10,2), txnDate datetime, pointsEarned integer), and a Redemption entity
   (redeemID UUID key, customerID association to Customer, pointsUsed integer, redeemDate
   datetime, remarks string).
2. **Reward policy config:** A RewardPolicy entity (policyID UUID key, channel string unique,
   pointsPerCurrencyUnit decimal(5,2)) and a TierThreshold entity (tier string key,
   minLifetimePoints integer), seeded with Online=0.05, Store=0.03, and Bronze=0/Silver=5000/
   Gold=20000.
3. **Service + roles:** All five entities exposed in a LoyaltyService at path
   /odata/v4/loyalty. RewardPolicy and TierThreshold restricted to the admin role only. Staff can
   read customers and create Transactions. Customers can read and create their own Redemptions and
   their own Customer/Transaction records, matched by email against the logged-in user.
4. **Points handler:** A before-CREATE handler on Transactions that validates the channel is
   Online or Store, computes pointsEarned from the channel's RewardPolicy rate
   (floor(amount × rate)), and increments the linked Customer's totalPoints and lifetimePoints,
   recomputing tier from lifetimePoints against the TierThreshold rows.
5. **Redemption handler:** A before-CREATE handler on Redemptions that rejects the request
   with a 400 if pointsUsed exceeds the customer's totalPoints, otherwise decrements totalPoints
   only — leaving lifetimePoints and tier unchanged so a full redemption never demotes a
   customer's tier.
6. **Live policy cache:** RewardPolicy and TierThreshold rows cached in memory on service
   startup, reloaded whenever an admin creates, updates, or deletes a RewardPolicy or
   TierThreshold row, so rate changes take effect on the very next purchase without a restart.
7. **Audit trail:** The `@cap-js/change-tracking` plugin, tracking changes to Customer's
   totalPoints, lifetimePoints, and tier, and to RewardPolicy/TierThreshold's rate/threshold
   fields.

## C. Other palette commands, and when they'd actually apply

These weren't needed for this build, but are worth knowing about if you extend the project in BAS:

- **`/hdi-gen`** — generates raw HDI design-time artifacts (`.hdbtable`, `.hdbrole`, etc.)
  directly. Not used here because this project deliberately stays on CAP's own HANA deployment
  path (`cds deploy` derives those artifacts automatically from `db/schema.cds`) — hand-authoring
  parallel HDI files would just create two sources of truth for the same tables. It becomes
  relevant only if you ever need a hand-crafted HANA artifact (e.g. a `.hdbrole` with permissions
  CAP doesn't model) that sits outside the CDS-generated set.
- **`/hana-sql-gen` / `/hana-modeling-help` / `/hana-expression-generation`** — ad-hoc SQL,
  calculation views, HANA expressions. This project has neither, so none apply.
- **`/ui5`** — general SAPUI5 assistant for hand-editing a generated app's controllers/views. Use
  it if you want to add custom logic on top of what `/fiori-gen-cap-ui` produced (e.g. a custom
  button action), rather than for the initial generation.
- **`/code-search`, `/sap-help`** — lookup tools, not generators; useful while working in BAS but
  produce no artifacts of their own.

Deployment (XSUAA, HTML5 repo, Approuter, MTA) isn't a Joule chat command either — it's the
`cds add xsuaa` / `cds add html5-repo` / `cds add approuter` / `cds add mta` CLI commands, run in
the BAS terminal, as already covered in `docs/05-deployment-steps.md`.
