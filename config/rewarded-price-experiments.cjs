'use strict';

const EXISTING_GAM_PRICING_RULE_CATALOG = Object.freeze({
  300: 'floor_price_300',
  250: 'floor_price_250',
  180: 'floor_price_180',
  120: 'floor_price_120',
  80: 'floor_price_80',
  50: 'floor_price_50',
  30: 'floor_price_30',
  15: 'floor_price_15',
  8: 'floor_price_8',
  5: 'floor_price_5',
  3: 'floor_price_3',
  1: 'floor_price_1'
});

const JOBGUIDEMATCH_REWARDED_V5 = Object.freeze({
  siteKey: 'jobguidematch.com',
  adUnitType: 'rewarded',
  slotName: 'rewarded',
  experimentKey: 'ads_exp_v5',
  variantPercentage: 0.8,
  attemptTimeoutMs: 1500,
  fallback: 'normal',
  ladder: Object.freeze([
    Object.freeze({ price: 300, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[300] }),
    Object.freeze({ price: 250, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[250] }),
    Object.freeze({ price: 180, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[180] }),
    Object.freeze({ price: 120, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[120] }),
    Object.freeze({ price: 80, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[80] }),
    Object.freeze({ price: 50, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[50] }),
    Object.freeze({ price: 30, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[30] })
  ])
});

const JOBGUIDEMATCH_DISPLAY_FAST_LOAD = Object.freeze({
  siteKey: 'jobguidematch.com',
  adUnitTypes: Object.freeze(['native', 'anchor']),
  experimentKey: 'ads_exp_v6',
  variantPercentage: 0.8,
  refreshRoundTargetingKey: 'refresh_round',
  fallback: 'normal',
  initialLadder: Object.freeze([
    Object.freeze({ price: 3, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[3] }),
    Object.freeze({ price: 1, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[1] })
  ]),
  refreshDelayMs: 30000,
  maximumRefreshes: 3,
  retryTimeoutMs: 0,
  visibilityFirst: true,
  visibilityFirstAdUnitTypes: Object.freeze(['native']),
  lazyLoadMarginPx: 300,
  refreshLadders: Object.freeze([
    Object.freeze([
      Object.freeze({ price: 5, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[5] }),
      Object.freeze({ price: 3, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[3] }),
      Object.freeze({ price: 1, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[1] })
    ]),
    Object.freeze([
      Object.freeze({ price: 8, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[8] }),
      Object.freeze({ price: 5, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[5] }),
      Object.freeze({ price: 3, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[3] }),
      Object.freeze({ price: 1, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[1] })
    ]),
    Object.freeze([
      Object.freeze({ price: 15, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[15] }),
      Object.freeze({ price: 8, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[8] }),
      Object.freeze({ price: 5, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[5] }),
      Object.freeze({ price: 3, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[3] }),
      Object.freeze({ price: 1, pricingRule: EXISTING_GAM_PRICING_RULE_CATALOG[1] })
    ])
  ])
});

function ladderPrices(ladder) {
  return ladder.map(item => item.price);
}

function ladderPricingRules(ladder) {
  return ladder.map(item => item.pricingRule);
}

function rewardedV5Prices() {
  return JOBGUIDEMATCH_REWARDED_V5.ladder.map(item => item.price);
}

function rewardedV5PricingRules() {
  return JOBGUIDEMATCH_REWARDED_V5.ladder.map(item => item.pricingRule);
}

function displayFastLoadInitialPrices() {
  return ladderPrices(JOBGUIDEMATCH_DISPLAY_FAST_LOAD.initialLadder);
}

function displayFastLoadRefreshLadders() {
  return JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshLadders.map(ladderPrices);
}

function displayFastLoadRoundLadders() {
  return [displayFastLoadInitialPrices(), ...displayFastLoadRefreshLadders()];
}

function displayFastLoadPricingRulesByRound() {
  return [
    ladderPricingRules(JOBGUIDEMATCH_DISPLAY_FAST_LOAD.initialLadder),
    ...JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshLadders.map(ladderPricingRules)
  ];
}

function displayFastLoadAdUnitTypes() {
  return JOBGUIDEMATCH_DISPLAY_FAST_LOAD.adUnitTypes.slice();
}

function displayFastLoadVisibilityAdUnitTypes() {
  return JOBGUIDEMATCH_DISPLAY_FAST_LOAD.visibilityFirstAdUnitTypes.slice();
}

function assertRequiredPricingRulesExist() {
  const requiredPrices = Array.from(new Set([
    ...rewardedV5Prices(),
    ...displayFastLoadRoundLadders().flat()
  ]));
  const missing = requiredPrices
    .filter(price => !EXISTING_GAM_PRICING_RULE_CATALOG[price])
    .map(price => `floor_price_${price}`);
  if (missing.length) {
    throw new Error(`Missing configured GAM pricing rules: ${missing.join(', ')}`);
  }
}

module.exports = {
  EXISTING_GAM_PRICING_RULE_CATALOG,
  JOBGUIDEMATCH_REWARDED_V5,
  JOBGUIDEMATCH_DISPLAY_FAST_LOAD,
  rewardedV5Prices,
  rewardedV5PricingRules,
  displayFastLoadInitialPrices,
  displayFastLoadRefreshLadders,
  displayFastLoadRoundLadders,
  displayFastLoadPricingRulesByRound,
  displayFastLoadAdUnitTypes,
  displayFastLoadVisibilityAdUnitTypes,
  assertRequiredPricingRulesExist
};
