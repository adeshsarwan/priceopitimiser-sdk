// Package the verified production SDK with site-key and existing real-preload settings.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root='reports/jobs-onboarding-20261009';
const sdk=fs.readFileSync(`${root}/live-publisher-sdk.js`,'utf8');
assert.equal(crypto.createHash('sha256').update(sdk).digest('hex'),'dbda68d916f22987eba233eb255f83d5d78c9206f544224cb2691f6eb61e96e6');
const original='var ir={siteKey:Ti(),placements:[],interstitials:[],rewarded:[]}';
assert.equal(sdk.split(original).length,2);
const configuredSdk=sdk.replace(original,'var ir={siteKey:Ti(),displayPreloadMode:"real",placements:[],interstitials:[],rewarded:[]}');
for(const site of ['jobscurated.com','jobsproven.com','jobsqualified.com']) {
 const prefix=`/* Price Optimiser: ${site}; existing SDK, real display preload enabled. */\n(function(){var s=document.currentScript;if(s)s.setAttribute('data-po-site',${JSON.stringify(site)});})();\n`;
 fs.writeFileSync(`deliverables/jobs-onboarding-20261009/${site}.js`,prefix+configuredSdk);
}
