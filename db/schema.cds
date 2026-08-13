namespace loyalty;

entity Customer {
  key customerID   : UUID;
  name             : String(120);
  email            : String(254);
  totalPoints      : Integer default 0;
  lifetimePoints   : Integer default 0;
  tier             : String(10) default 'Bronze';
  transactions     : Association to many Transaction on transactions.customerID = $self;
  redemptions      : Association to many Redemption on redemptions.customerID = $self;
}

entity Transaction {
  key txnID        : UUID;
  // Named `customerID` per the source spec's literal Domain Modelling table.
  // Because Customer's own key is also `customerID`, this generates the
  // physical/OData column `customerID_customerID` — kept deliberately.
  customerID       : Association to Customer;
  channel          : String(10);
  amount           : Decimal(10,2);
  txnDate          : DateTime;
  pointsEarned     : Integer default 0;
}

entity Redemption {
  key redeemID     : UUID;
  customerID       : Association to Customer;
  pointsUsed       : Integer;
  redeemDate       : DateTime;
  remarks          : String(255);
}

entity RewardPolicy {
  key policyID             : UUID;
  channel                  : String(10);
  pointsPerCurrencyUnit    : Decimal(5,2);
}

entity TierThreshold {
  key tier             : String(10);
  minLifetimePoints    : Integer;
}

annotate RewardPolicy with @assert.unique: { channel: [ channel ] };
