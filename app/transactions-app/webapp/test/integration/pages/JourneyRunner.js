sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"transactionsapp/test/integration/pages/TransactionsList.gen",
	"transactionsapp/test/integration/pages/TransactionsObjectPage.gen"
], function (JourneyRunner, TransactionsListGenerated, TransactionsObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('transactionsapp') + '/test/flp.html#app-preview',
        pages: {
			onTheTransactionsListGenerated: TransactionsListGenerated,
			onTheTransactionsObjectPageGenerated: TransactionsObjectPageGenerated
        },
        async: true
    });

    return runner;
});

