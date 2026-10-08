# Where to host Ringside: options compared

Prices and facts below were read from the providers' own pages on 7 October 2026. Prices change; check the page before you pay (links at the end). Nothing here is a recommendation to buy before you have decided the points in "Decide first".

## What Ringside needs from a host

- A server that runs all the time (Node.js), not a "serverless" host that sleeps or resets: the site keeps its data in a SQLite file that must survive restarts.
- A **persistent disk** (a "volume") of a few GB.
- A scheduled job once a night to update the data (`npm run data:ingest`).
- HTTPS and your own domain name.

## Decide first

1. **Do you want the data kept inside Saudi Arabia?** If the site will hold user accounts or any personal data, ask your organisation's legal or security office whether it must be hosted in the Kingdom. I am not a lawyer and cannot answer that. If the answer is yes, only the Saudi options below qualify. If it is a public stats site with no personal data, a nearby region is usually enough.
2. **Who will look after it?** A managed platform (Fly.io, Railway) needs less upkeep than a plain server you rent (Hetzner, Oracle), where you do updates and security patches yourself.

## The options

| Option | Where the servers are | Rough cost for Ringside | Disk | Upkeep |
|---|---|---|---|---|
| **Fly.io** | Amsterdam, Frankfurt, Paris, London, Stockholm, Johannesburg, Singapore, US, and others. **None in the Middle East.** | Smallest machine $2.19 a month (256 MB), $3.69 (512 MB), $6.70 (1 GB). Disk $0.15 per GB a month. Outbound data $0.02 per GB in Europe, $0.04 in Asia. No free tier. | Yes, volumes | Low |
| **Railway** | California, Virginia, Amsterdam, Singapore. **None in the Middle East.** | Hobby plan $5 a month including $5 of usage. Then $20 per vCPU, $10 per GB of memory, $0.15 per GB of disk (all per month), $0.05 per GB outbound. Hobby disk limit 5 GB. | Yes, volumes | Low |
| **Hetzner Cloud** | Germany, Finland, USA, Singapore. **None in the Middle East.** | CX23 server €5.49 a month ($6.49) in Germany or Finland; CPX12 €15.49 ($17.99) in Singapore. Prices exclude VAT and the IPv4 address. | Yes, the server's own disk | Medium (you run the server) |
| **Oracle Cloud** | **Riyadh and Jeddah, Saudi Arabia** | Has an "Always Free" tier covering small compute and block storage; the page does not state exact sizes, so check it. | Yes | Medium to high |
| **Google Cloud** | **Dammam, Saudi Arabia** (me-central2) | Pay per use; price depends on the machine you choose | Yes | Medium to high |
| **Alibaba Cloud / Huawei Cloud** | **Riyadh** | Pay per use | Yes | Medium to high |
| **Azure** | Saudi Arabia region reported as planned for late 2026; the UAE is used meanwhile | Pay per use | Yes | Medium to high |
| **AWS** | One source says Riyadh went live in January 2026, another still lists it as announced. UAE and Bahrain regions exist nearby. Check AWS's own regions page. | Pay per use | Yes | Medium to high |

## What this means in plain terms

- **If data may sit outside the Kingdom:** Fly.io or Railway is the easiest. Neither has a Gulf region, so pages come from Europe or Singapore and are a little slower for readers in Riyadh. A free-or-cheap CDN in front softens this: Cloudflare lists data centres in Riyadh, Jeddah and Dammam, and caching static files there helps.
- **If data must stay in the Kingdom:** Oracle (Riyadh or Jeddah) or Google Cloud (Dammam) are the live, named choices. These are more work to set up and look after than Fly.io, and the cost is harder to predict from their price pages.
- **Cheapest honest estimate for a small managed setup:** a 512 MB machine plus a 3 GB disk on Fly.io is about $4.14 a month plus a little for data. That is the platform bill only: a domain name costs extra.

I have not tested Ringside on any of these. Fly.io and Railway need a short configuration file (a Dockerfile) that I can write and test locally; that is the next step once you pick.

## Steps once you have chosen (managed platform)

1. Create an account with the provider (you do this, with your own payment details).
2. Tell me which one; I prepare the deploy files in a pull request and test them locally.
3. You install the provider's command-line tool, log in, and run the deploy command I give you.
4. Create the disk, set the settings listed in `docs/go-live.md`, point your domain name at the site.
5. Add the nightly update job (`docs/go-live.md`, section on scheduled updates) and the staleness alert.

## Sources

- [Fly.io resource pricing](https://docs.fly.io/about/pricing)
- [Fly.io regions](https://docs.fly.io/reference/regions)
- [Railway plans and prices](https://docs.railway.com/pricing/plans)
- [Railway deployment regions](https://docs.railway.com/reference/deployment-regions)
- [Hetzner price adjustment, 15 June 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)
- [Cloud regions in Saudi Arabia (2026) — alskyline](https://alskyline.com/kb/cloud-regions-saudi-arabia-2026-guide)
- [Cloud providers with data centres in Saudi Arabia — getdeploying](https://getdeploying.com/datacenters-in-saudi-arabia)
