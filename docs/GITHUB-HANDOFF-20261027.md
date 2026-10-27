# GitHub source handoff — 27 October 2026

This branch captures the local publisher SDK source, tests, documentation and rebuilt dist assets. Backend and Rules API source live separately at https://github.com/adeshsarwan/priceoptimiser/tree/codex/rules-api-sync-20261027 .

No services were deployed by this source upload. Credentials, reports, rollback archives, dependency directories and ZIP deliverables are excluded. Unpacked publisher instructions and onboarding scripts are included.

Validation: npm run build passed. npm test recorded 132 passed and 9 cancelled; the public refreshSlots round-one waterfall test left a promise pending, cancelling subsequent tests in that file. This is not a fully passing suite and needs investigation before deploying this snapshot.

Native and Anchor refresh_round targeting is 0 for the initial opportunity and 1, 2, 3 for successive refresh opportunities. Values are sent as strings. Waterfall attempts and the unpriced fallback retain the same round. The helper caps targeting at 3; the key is emitted only when the runtime targeting configuration enables it.
