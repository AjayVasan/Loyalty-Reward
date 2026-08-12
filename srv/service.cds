using { loyalty } from '../db/schema';

@path: '/odata/v4/loyalty'
service LoyaltyService @(requires: 'authenticated-user') {

  entity Customers      as projection on loyalty.Customer;
  entity Transactions   as projection on loyalty.Transaction;
  entity Redemptions    as projection on loyalty.Redemption;
  entity RewardPolicies as projection on loyalty.RewardPolicy;
  entity TierThresholds as projection on loyalty.TierThreshold;
}

annotate LoyaltyService.Customers with @(restrict: [
  { grant: 'READ', to: 'admin' },
  { grant: 'READ', to: 'staff' },
  { grant: 'READ', to: 'customer', where: 'email = $user.email' }
]);

annotate LoyaltyService.Transactions with @(restrict: [
  { grant: ['READ', 'CREATE'], to: 'admin' },
  { grant: ['READ', 'CREATE'], to: 'staff' },
  { grant: 'READ', to: 'customer', where: 'customerID.email = $user.email' }
]);

annotate LoyaltyService.Redemptions with @(restrict: [
  { grant: ['READ', 'CREATE'], to: 'admin' },
  { grant: ['READ', 'CREATE'], to: 'customer', where: 'customerID.email = $user.email' }
]);

annotate LoyaltyService.RewardPolicies with @(restrict: [
  { grant: '*', to: 'admin' }
]);

annotate LoyaltyService.TierThresholds with @(restrict: [
  { grant: '*', to: 'admin' }
]);
