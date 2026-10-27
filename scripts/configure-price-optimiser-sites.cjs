#!/usr/bin/env node
'use strict';

const {
  JOBGUIDEMATCH_REWARDED_V5,
  JOBGUIDEMATCH_DISPLAY_FAST_LOAD,
  rewardedV5Prices,
  displayFastLoadInitialPrices,
  displayFastLoadRefreshLadders,
  displayFastLoadAdUnitTypes,
  displayFastLoadVisibilityAdUnitTypes,
  assertRequiredPricingRulesExist
} = require('../config/rewarded-price-experiments.cjs');

let cachedPool = null;

function dbPool() {
  if (!cachedPool) {
    ({ pool: cachedPool } = require('/var/www/priceoptimizer1/server/src/db.cjs'));
  }
  return cachedPool;
}

const defaultSizesByType = {
  native: 'fluid',
  banner: [[320, 50], [728, 90], [300, 250]],
  sidebar: [[300, 250], [300, 600]],
  anchor: [[320, 50], [728, 90]],
  interstitial: null,
  rewarded: null
};

function placementType(unit) {
  if (unit.type === 'banner' && unit.slotKey === 'ad-sidebar') return 'sidebar';
  return unit.type;
}

function sizesFor(unit) {
  return defaultSizesByType[placementType(unit)];
}

function isPagePlacement(unit) {
  return unit.type !== 'interstitial' && unit.type !== 'rewarded';
}

function domIdFor(unit) {
  return isPagePlacement(unit) ? unit.slotKey : null;
}

function isJobGuideMatchRewarded(site, typeOrUnit) {
  const type = typeof typeOrUnit === 'string' ? typeOrUnit : typeOrUnit.type;
  return site.siteKey === JOBGUIDEMATCH_REWARDED_V5.siteKey &&
    type === JOBGUIDEMATCH_REWARDED_V5.adUnitType;
}

function isJobGuideMatchFastDisplay(site, typeOrUnit) {
  const type = typeof typeOrUnit === 'string' ? typeOrUnit : typeOrUnit.type;
  return site.siteKey === JOBGUIDEMATCH_DISPLAY_FAST_LOAD.siteKey &&
    displayFastLoadAdUnitTypes().includes(type);
}

function waterfallFor(site, type) {
  if (isJobGuideMatchFastDisplay(site, type)) return displayFastLoadInitialPrices();
  return isJobGuideMatchRewarded(site, type) ? rewardedV5Prices() : defaultFloors;
}

function retryLimitFor(site, unit) {
  if (unit.type === 'interstitial') return 1;
  if (isJobGuideMatchRewarded(site, unit)) return rewardedV5Prices().length;
  if (isJobGuideMatchFastDisplay(site, unit)) return displayFastLoadInitialPrices().length;
  return 4;
}

function maximumRewardedAttemptsFor(site, unit) {
  if (isJobGuideMatchRewarded(site, unit)) return rewardedV5Prices().length;
  return 2;
}

function retryTimeoutMsFor(site, unit) {
  if (isJobGuideMatchRewarded(site, unit)) return JOBGUIDEMATCH_REWARDED_V5.attemptTimeoutMs;
  if (isJobGuideMatchFastDisplay(site, unit)) return JOBGUIDEMATCH_DISPLAY_FAST_LOAD.retryTimeoutMs;
  return 2500;
}

function refreshEnabledFor(site, unit) {
  return isPagePlacement(unit) ? 1 : 0;
}

function refreshDelayMsFor(site, unit) {
  if (isJobGuideMatchFastDisplay(site, unit)) return JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshDelayMs;
  return 30000;
}

function maximumRefreshesFor(site, unit) {
  if (isJobGuideMatchFastDisplay(site, unit)) return JOBGUIDEMATCH_DISPLAY_FAST_LOAD.maximumRefreshes;
  return isPagePlacement(unit) ? 2 : 0;
}

function refreshLaddersFor(site, type) {
  return isJobGuideMatchFastDisplay(site, type) ? displayFastLoadRefreshLadders() : [];
}

function experimentFor(site, type) {
  if (isJobGuideMatchFastDisplay(site, type)) {
    return {
      experimentKey: JOBGUIDEMATCH_DISPLAY_FAST_LOAD.experimentKey,
      variantPercentage: JOBGUIDEMATCH_DISPLAY_FAST_LOAD.variantPercentage
    };
  }
  if (isJobGuideMatchRewarded(site, type)) {
    return {
      experimentKey: JOBGUIDEMATCH_REWARDED_V5.experimentKey,
      variantPercentage: JOBGUIDEMATCH_REWARDED_V5.variantPercentage
    };
  }
  return null;
}

function refreshRoundTargetingKeyFor(site, type) {
  return isJobGuideMatchFastDisplay(site, type) ? JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshRoundTargetingKey : null;
}

function targetingPolicyFor(site, type) {
  if (!isJobGuideMatchFastDisplay(site, type)) return null;
  return {
    control: ['exp_group', 'exp_key', 'slot_name', JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshRoundTargetingKey],
    variant: ['exp_group', 'exp_key', 'slot_name', JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshRoundTargetingKey, 'price_rule']
  };
}

function visibilityFirstFor(site, unit) {
  const type = typeof unit === 'string' ? unit : unit.type;
  return Boolean(
    site.siteKey === JOBGUIDEMATCH_DISPLAY_FAST_LOAD.siteKey &&
    JOBGUIDEMATCH_DISPLAY_FAST_LOAD.visibilityFirst &&
    displayFastLoadVisibilityAdUnitTypes().includes(type)
  );
}

function lazyLoadMarginPxFor(site, unit) {
  return visibilityFirstFor(site, unit) ? JOBGUIDEMATCH_DISPLAY_FAST_LOAD.lazyLoadMarginPx : null;
}

function variantFloorFor(site, type) {
  if (isJobGuideMatchFastDisplay(site, type)) return displayFastLoadInitialPrices()[0];
  return isJobGuideMatchRewarded(site, type) ? rewardedV5Prices()[0] : 1.2;
}

const sites = [
  {
    siteKey: 'quiz-rush.com',
    domain: 'quiz-rush.com',
    name: 'Quiz Rush',
    adUnits: [
      { slotKey: 'interstitial', adUnitName: '/23360556473/quiz-rush.com_Interstitial', type: 'interstitial' },
      { slotKey: 'ad-leaderboard', adUnitName: '/23360556473/quiz-rush.com_Native', type: 'native' },
      { slotKey: 'ad-incontent', adUnitName: '/23360556473/quiz-rush.com_Native', type: 'native' },
      { slotKey: 'ad-results', adUnitName: '/23360556473/quiz-rush.com_Native', type: 'native' },
      { slotKey: 'rewarded', adUnitName: '/23360556473/quiz-rush.com_Rewarded', type: 'rewarded' },
      { slotKey: 'ad-sidebar', adUnitName: '/23360556473/quiz-rush.com_SidebarBanner', type: 'banner' },
      { slotKey: 'ad-anchor', adUnitName: '/23360556473/quiz-rush.com_Anchor', type: 'anchor' }
    ],
    pageRules: [
      { pageKey: 'quiz-question', pathPattern: '/quiz/*/q/*', priority: 10 },
      { pageKey: 'quiz-results', pathPattern: '/quiz/*/results/', priority: 20 }
    ]
  },
  {
    siteKey: 'jobguidematch.com',
    domain: 'jobguidematch.com',
    name: 'Job Guide Match',
    experimentKey: JOBGUIDEMATCH_REWARDED_V5.experimentKey,
    variantPercentage: JOBGUIDEMATCH_REWARDED_V5.variantPercentage,
    adUnits: [
      { slotKey: 'interstitial', adUnitName: '/23350639211/jobguidematch.com_Interstitial', type: 'interstitial' },
      { slotKey: 'ad-leaderboard', adUnitName: '/23350639211/jobguidematch.com_Native', type: 'native' },
      { slotKey: 'ad-incontent', adUnitName: '/23350639211/jobguidematch.com_Native', type: 'native' },
      { slotKey: 'ad-results', adUnitName: '/23350639211/jobguidematch.com_Native', type: 'native' },
      { slotKey: 'rewarded', adUnitName: '/23350639211/jobguidematch.com_Rewarded', type: 'rewarded' },
      { slotKey: 'ad-anchor', adUnitName: '/23350639211/jobguidematch.com_Anchor', type: 'anchor' }
    ],
    pageRules: [
      { pageKey: 'job-results', pathPattern: '/find/results/', priority: 10 },
      { pageKey: 'job-apply', pathPattern: '/find/apply/*', priority: 20 }
    ]
  }
];

const defaultFloors = [300, 250, 180, 120, 80, 50, 30, 20, 15, 12, 8, 5, 3, 2, 1, 0.5, 0.2, 0.1];
const priceKeys = ['IN', 'US', 'GB', 'CA', 'AU', 'rest_of_world'];

async function configureSites() {
  assertRequiredPricingRulesExist();

  const pool = dbPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const site of sites) {
      const experimentKey = site.experimentKey || 'ads_exp_v4';
      const variantPercentage = site.variantPercentage == null ? 0.5 : site.variantPercentage;

      await conn.query(`
        INSERT INTO sites
          (site_key, domain, name, status, experiment_key, variant_percentage, integration_mode,
           enable_banner, enable_anchor, enable_native, enable_interstitial, enable_rewarded, debug_enabled)
        VALUES (?, ?, ?, 'active', ?, ?, 'waterfall_only', 1, 1, 1, 1, 1, 0)
        ON DUPLICATE KEY UPDATE
          domain=VALUES(domain),
          name=VALUES(name),
          status='active',
          experiment_key=VALUES(experiment_key),
          variant_percentage=VALUES(variant_percentage),
          integration_mode=VALUES(integration_mode),
          enable_banner=1,
          enable_anchor=1,
          enable_native=1,
          enable_interstitial=1,
          enable_rewarded=1,
          updated_at=NOW()
      `, [site.siteKey, site.domain, site.name, experimentKey, variantPercentage]);

      if (site.experimentKey) {
        await conn.query(`
          UPDATE experiments
          SET enabled=0,
              ended_at=COALESCE(ended_at, NOW()),
              updated_at=NOW()
          WHERE site_key=?
            AND exp_key<>?
        `, [site.siteKey, experimentKey]);

        await conn.query(`
          INSERT INTO experiments
            (site_key, exp_key, enabled, variant_percentage,
             enable_banner, enable_anchor, enable_native, enable_interstitial, enable_rewarded,
             started_at, ended_at)
          VALUES (?, ?, 1, ?, 1, 1, 1, 1, 1, NOW(), NULL)
          ON DUPLICATE KEY UPDATE
            enabled=1,
            variant_percentage=VALUES(variant_percentage),
            enable_banner=1,
            enable_anchor=1,
            enable_native=1,
            enable_interstitial=1,
            enable_rewarded=1,
            started_at=COALESCE(started_at, NOW()),
            ended_at=NULL,
            updated_at=NOW()
        `, [site.siteKey, experimentKey, variantPercentage]);
      }

      for (const rule of site.pageRules) {
        await conn.query(`
          INSERT INTO page_rules (site_key, page_key, path_pattern, integration_mode, priority, enabled)
          VALUES (?, ?, ?, 'waterfall_only', ?, 1)
          ON DUPLICATE KEY UPDATE
            path_pattern=VALUES(path_pattern),
            integration_mode=VALUES(integration_mode),
            priority=VALUES(priority),
            enabled=1,
            updated_at=NOW()
        `, [site.siteKey, rule.pageKey, rule.pathPattern, rule.priority]);
      }

      for (const unit of site.adUnits) {
        const domId = domIdFor(unit);
        await conn.query(`
	          INSERT INTO ad_units
	            (site_key, page_key, slot_key, ad_unit_name, ad_unit_type, dom_id, dom_selector, integration_mode,
	             enabled, sizes_json, targeting_key, pos, retry_limit, retry_timeout_ms, refresh_enabled,
	             refresh_delay_ms, maximum_refreshes, rewarded_request_timeout_ms, maximum_rewarded_attempts, reward_points)
	          VALUES (?, NULL, ?, ?, ?, ?, ?, 'both', 1, CAST(? AS JSON), 'price_rule', ?, ?, ?, ?, ?, ?, 15000, ?, 50)
          ON DUPLICATE KEY UPDATE
            ad_unit_name=VALUES(ad_unit_name),
            ad_unit_type=VALUES(ad_unit_type),
            dom_id=VALUES(dom_id),
            dom_selector=VALUES(dom_selector),
            integration_mode=VALUES(integration_mode),
            enabled=1,
            sizes_json=VALUES(sizes_json),
            targeting_key='price_rule',
            pos=VALUES(pos),
            retry_limit=VALUES(retry_limit),
            retry_timeout_ms=VALUES(retry_timeout_ms),
            refresh_enabled=VALUES(refresh_enabled),
            refresh_delay_ms=VALUES(refresh_delay_ms),
            maximum_refreshes=VALUES(maximum_refreshes),
            rewarded_request_timeout_ms=VALUES(rewarded_request_timeout_ms),
            maximum_rewarded_attempts=VALUES(maximum_rewarded_attempts),
            reward_points=VALUES(reward_points),
            updated_at=NOW()
        `, [
          site.siteKey,
          unit.slotKey,
          unit.adUnitName,
          unit.type,
          domId,
          domId ? `#${domId}` : null,
          JSON.stringify(sizesFor(unit)),
	          unit.pos || null,
	          retryLimitFor(site, unit),
	          retryTimeoutMsFor(site, unit),
	          refreshEnabledFor(site, unit),
	          refreshDelayMsFor(site, unit),
	          maximumRefreshesFor(site, unit),
	          maximumRewardedAttemptsFor(site, unit)
	        ]);
	      }

	      for (const type of ['banner', 'anchor', 'native', 'interstitial', 'rewarded']) {
	        for (const priceKey of priceKeys) {
	          const shouldUpdateWaterfall = isJobGuideMatchRewarded(site, type) || isJobGuideMatchFastDisplay(site, type);
	          await conn.query(`
            INSERT INTO geo_prices
              (site_key, ad_unit_type, region_group, control_floor, variant_floor, waterfall_json, enabled, updated_by_optimizer)
            VALUES (?, ?, ?, 1.0000, ?, CAST(? AS JSON), 1, 0)
            ON DUPLICATE KEY UPDATE
              enabled=1,
              ${shouldUpdateWaterfall ? 'variant_floor=VALUES(variant_floor),' : ''}
              ${shouldUpdateWaterfall ? 'waterfall_json=VALUES(waterfall_json),' : ''}
              updated_at=NOW()
          `, [site.siteKey, type, priceKey, variantFloorFor(site, type), JSON.stringify(waterfallFor(site, type))]);
        }
      }

      if (site.siteKey === JOBGUIDEMATCH_REWARDED_V5.siteKey) {
        await conn.query(`
          UPDATE geo_prices
          SET variant_floor=?,
              waterfall_json=CAST(? AS JSON),
              updated_by_optimizer=0,
              updated_at=NOW()
          WHERE site_key=?
            AND ad_unit_type=?
            AND enabled=1
        `, [
          variantFloorFor(site, JOBGUIDEMATCH_REWARDED_V5.adUnitType),
          JSON.stringify(rewardedV5Prices()),
          site.siteKey,
          JOBGUIDEMATCH_REWARDED_V5.adUnitType
        ]);
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  for (const site of sites) {
    const [adUnits] = await pool.query(
      'SELECT slot_key, ad_unit_name, ad_unit_type, dom_id, dom_selector FROM ad_units WHERE site_key=? ORDER BY slot_key',
      [site.siteKey]
    );
    console.log(JSON.stringify({ siteKey: site.siteKey, adUnits }, null, 2));
  }
}

if (require.main === module) {
  configureSites()
    .catch(error => {
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (cachedPool) await cachedPool.end().catch(() => {});
    });
}

module.exports = {
  sites,
  defaultFloors,
  priceKeys,
	  configureSites,
	  isJobGuideMatchRewarded,
	  isJobGuideMatchFastDisplay,
	  waterfallFor,
	  retryLimitFor,
	  maximumRewardedAttemptsFor,
	  retryTimeoutMsFor,
	  refreshEnabledFor,
		  refreshDelayMsFor,
		  maximumRefreshesFor,
		  refreshLaddersFor,
		  experimentFor,
		  refreshRoundTargetingKeyFor,
		  targetingPolicyFor,
		  visibilityFirstFor,
		  lazyLoadMarginPxFor,
		  variantFloorFor
		};
