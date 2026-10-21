# Lodeline product and build plan

This folder is the plan for turning Dylan's trace demo into the Lodeline product: a customer dashboard with traces and evidence packs, a China-free supplier marketplace, and a supply-chain map. It is a plan only. No code in this repo changes because of it.

## Summary

Lodeline helps US defense suppliers show that the magnets, tungsten and tantalum in their parts do not pass through China, Russia, Iran or North Korea, as DFARS 252.225-7052 requires from January 1, 2027. We give away a parts-list check and a China-free supplier directory, and sell hand-done traces (then annual plans) that send questionnaires up the supply chain to the mine and return a page-cited evidence pack. Dylan's Vercel trace demo is the base product. We add customer accounts, then a dashboard with Traces, Evidence packs, Marketplace, Supply-chain map and My listings tabs. We port the directory, matchmaking and safety code that already exists in this repo, and retire the rest. Before building beyond Phase 0, we test demand: if fewer than 3 of about 40 buyers would pay for a trace, we stop or change direction.

## Files

| File | What it covers |
|---|---|
| [01-product.md](01-product.md) | What we sell, to whom, how a trace works, the rule, validation test, competitors, where the demo fits |
| [02-architecture.md](02-architecture.md) | Dylan's app as the base, target dashboard, routes, data model, customer accounts |
| [03-port-from-lodeline-platform.md](03-port-from-lodeline-platform.md) | What to port from this repo and what to retire (paths checked against `main` at `65fa2a9`) |
| [04-marketplace-data.md](04-marketplace-data.md) | Seeding the marketplace from the supplier DB export, labels, import, verification |
| [05-security-compliance.md](05-security-compliance.md) | Data we must not hold, uploads, AI use, claims we must not make, repo hygiene |
| [06-roadmap.md](06-roadmap.md) | Phases 0 to 5 with owners, and open questions for Dylan |

## Owners (placeholders)

- Dylan: app
- Yash: sales and data
- Delilah: Taiwan supplier side

Unknowns are marked **TBD** throughout.
