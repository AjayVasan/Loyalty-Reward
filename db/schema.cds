using { managed } from '@sap/cds/common';

namespace loyalty;

entity Customer : managed {
  key customerID   : UUID;
  name             : String(120);
  email            : String(254);
  totalPoints      : Integer default 0;
  lifetimePoints   : Integer default 0;
  // Not a CDS enum: TierThreshold is deliberately open-ended (see there) — computeTier()
  // picks up whatever tier names exist as TierThreshold rows, with no hardcoded list.
  tier             : String(10) default 'Bronze';
  transactions     : Association to many Transaction on transactions.customerID = $self;
  redemptions      : Association to many Redemption on redemptions.customerID = $self;
}

entity Transaction : managed {
  key txnID        : UUID;
  // Named `customerID` per the source spec's literal Domain Modelling table.
  // Because Customer's own key is also `customerID`, this generates the
  // physical/OData column `customerID_customerID` — kept deliberately.
  customerID       : Association to Customer;
  channel          : String(10) enum { Online; Store };
  amount           : Decimal(10,2);
  txnDate          : DateTime;
  pointsEarned     : Integer default 0;
}

entity Redemption : managed {
  key redeemID     : UUID;
  customerID       : Association to Customer;
  pointsUsed       : Integer;
  redeemDate       : DateTime;
  remarks          : String(255);
}

entity RewardPolicy : managed {
  key policyID             : UUID;
  channel                  : String(10) enum { Online; Store };
  pointsPerCurrencyUnit    : Decimal(5,2);
}

entity TierThreshold : managed {
  // Deliberately not a CDS enum: this table exists so admins can define/extend the tier
  // ladder (see srv/lib/tier.js's computeTier, which hardcodes no tier names) without a
  // schema or code change — constraining `tier` here would defeat that purpose.
  key tier             : String(10);
  minLifetimePoints    : Integer;
}

annotate RewardPolicy with @assert.unique: { channel: [ channel ] };
