sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"tierthresholdapp/test/integration/pages/TierThresholdsList.gen",
	"tierthresholdapp/test/integration/pages/TierThresholdsObjectPage.gen"
], function (JourneyRunner, TierThresholdsListGenerated, TierThresholdsObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('tierthresholdapp') + '/test/flp.html#app-preview',
        pages: {
			onTheTierThresholdsListGenerated: TierThresholdsListGenerated,
			onTheTierThresholdsObjectPageGenerated: TierThresholdsObjectPageGenerated
        },
        async: true
    });

    return runner;
});

