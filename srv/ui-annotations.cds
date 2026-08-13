using { LoyaltyService } from './service';

annotate LoyaltyService.Customers with @(
  UI: {
    HeaderInfo: {
      TypeName: 'Customer', TypeNamePlural: 'Customers',
      Title: { Value: name }
    },
    LineItem: [
      { Value: name }, { Value: email }, { Value: totalPoints }, { Value: lifetimePoints }, { Value: tier }
    ],
    Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'Purchases', Target: 'transactions/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Redemptions', Target: 'redemptions/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Change History', Target: 'changes/@UI.PresentationVariant' }
    ]
  }
) {
  customerID @UI.Hidden;
};

annotate LoyaltyService.Transactions with @(
  UI.LineItem: [
    { Value: txnDate }, { Value: channel }, { Value: amount }, { Value: pointsEarned }
  ]
);

annotate LoyaltyService.Redemptions with @(
  UI.LineItem: [
    { Value: redeemDate }, { Value: pointsUsed }, { Value: remarks }
  ]
);
