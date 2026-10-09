# What the pages weigh, and what a CDN can and cannot do

**Measured on the live site (ringsidedb.fly.dev, Frankfurt), 9 October 2026, 33,614 fighters.** Not a lab test: one machine, one connection, from a US-based cloud sandbox, so read the shape, not the milliseconds.

## The pages are light

| Page | HTML sent (gzip) | HTML before gzip | First byte | DOM elements |
|---|---|---|---|---|
| Home | 26 KB | 195 KB | 0.3-0.8 s | 913 |
| Fighters | 29 KB | 271 KB | 0.3-0.6 s | 1,255 |
| Rankings, Events, Titles | 22-29 KB | 187-407 KB | 0.3 s | 815-1,695 |
| Upset watch (the heaviest) | 49 KB | 543 KB | 0.3 s | 3,701 |
| Map | 52 KB | 324 KB | 0.3 s | 1,829 |
| News, Money, Leaderboard, People, Orgs | 13-15 KB | 105-117 KB | 0.3 s | 437-480 |

All the scripts and styles of a page together are about 200 KB compressed, and they are served `public, max-age=31536000, immutable` (a visitor downloads them once). So the idea of trimming the lists was not worth doing: on the wire they are small.

## Where the bytes really are: pictures

- **Fighters' photos** came from Wikimedia at 480 px (58 KB for a JPEG) or, for some files, the original (up to 270 KB for a PNG), to fill a 64 px box. They are now asked for at the size shown (`lib/commons-thumb.ts`): **58 KB to 6.5 KB (JPEG), 267 KB to 34 KB (PNG)**, with the addresses checked against Commons. A list of 30 fighters goes from about 1.7 MB to about 0.2 MB.
- **Event posters** (36-140 KB each, 20-44 on a listing) come from the vendor's own image host (`assets.boxing-data.com`) and cannot be made smaller without storing a copy, which the vendor has not agreed to. They are lazy-loaded (only the first is fetched early). If the vendor allows it, an image proxy that resizes them is the next step.
- **Pictures on news cards and video thumbnails** are already saved and shrunk by this site (about 18 KB each).

## Why a CDN cannot cache the pages (and what it can still do)

Every page carries a Content Security Policy with a **fresh random value (a nonce) on every request**, which is what lets the page's own scripts run and nothing injected. A cache that served one visitor's page to another would hand out that value, and the protection would be gone, so pages are sent `no-store` on purpose. Making them cacheable would mean loosening the policy. I have not done that.

A CDN in front (Cloudflare has data centres in Riyadh, Jeddah and Dammam) still helps readers in Saudi Arabia, without caching a single page:

1. It answers the connection and the encryption handshake near the reader, which is most of the delay for a faraway server.
2. It caches `/_next/static/*` and the pictures the site serves itself (`/api/news-image/*`, `/api/video-thumb/*`, `/api/art/*`) at the edge.
3. It keeps HTTP/3 and compression ready for every visitor.

To set it up (you do this, with your own domain and account): put the domain on Cloudflare, proxy it to the Fly address, and add one rule, **Cache: bypass for everything except `/_next/static/*`, `/api/news-image/*`, `/api/video-thumb/*` and `/api/art/*`**. Keep "Always online" and HTML minification off. Do this only after the domain is chosen (`SITE_URL`), and check `/api/health` and the sign-in still work through it.
