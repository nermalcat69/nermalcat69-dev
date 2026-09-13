# Security Findings & Fixes (Next.js/TS on GCP)


## 1. No caching + no rate limit → DDoS risk (`/storage`)

Every request hits origin full-cost (auth + DB), no `304`s, no concurrency cap. A 5-concurrent `hey` burst has nothing absorbing it.

**Fix**
- `Cache-Control: private, max-age=15-60` + `ETag` on per-user GET endpoints.
- Rate limit: Cloud Armor rate-limiting rule in front of Cloud Run (per-IP), or `@upstash/ratelimit` + Memorystore/Upstash Redis in the Next.js middleware/route handler. Target ~60/min on heavy endpoints, `429` + `Retry-After` on breach.
- Cloud Armor "Adaptive Protection" for load-test-shaped traffic (identical headers, high rate, single IP).
- Cap pagination/result size so one request can't be made arbitrarily expensive.

## 2. Unbounded write endpoints — invites, networks, SSH keys

Same bug class three times: no per-org cap, weak/no rate limit, so an attacker scripts unlimited `POST`s. Worst case is invites — spam damages sending-domain reputation (future real emails land in spam).

**Fix (one shared middleware, not three)**
- Rate limit by IP + user on all write routes (same Redis limiter as #1).
- Per-org quota check before insert (e.g. 50 pending invites, 50 networks, 50 SSH keys) → `403` over cap.
- Invites specifically: queue via Cloud Tasks and return `202`, add re-invite cooldown, restrict to allowed domains if applicable.

## 3. Session/device binding to catch stolen-cookie replay

Info-stealer malware exfiltrates session cookies; attacker replays from a different IP/device with zero password/MFA needed.

**Fix**
- Bind each session at login to: IP, ASN, country/city (from `x-forwarded-for` behind GCP Load Balancer, or Cloud Armor's client IP header — GCP doesn't inject Cloudflare-style geo headers, so resolve country/ASN server-side via a MaxMind GeoIP lookup or GCP's `X-Client-Region`/`X-Client-City` headers if using Cloud CDN, or a lightweight IP-geo API call at login only).
- Store baseline server-side only (Postgres/Cloud SQL table), never in `localStorage` or a readable cookie — session cookie stays `HttpOnly`.
- On drift (new city/country), don't block — show a "new location" prompt and send a one-time magic-link email (short-lived, single-use, rate-limited) before continuing.
- Log every check/decision (`ALLOW`/`STEP_UP`/`BLOCK`) to an audit table.

## 4. CSP `unsafe-inline`

`script-src`/`style-src` allow inline scripts, defeating CSP's XSS containment even though no injection point is currently known.

**Fix:** switch to a per-request nonce in `next.config.js`/middleware (`Content-Security-Policy: script-src 'nonce-<value>' 'strict-dynamic'`), drop `unsafe-inline`.

## 5. Unbounded volumes list → 14-15s load, DoS amplification (`/portfolio`)

Volumes list has no pagination — duplicating one entry to the 72-item cap makes the page fetch/render all 72 in one shot (~14-15s load). No pagination means list cost scales O(n), so the same endpoint amplifies load under repeat/concurrent requests. `/portfolio` also fires several API calls unrelated to what it renders.

**Fix**
- Add `limit`/`cursor` params to the volumes list API; return a bounded page, not the full set.
- Paginate/lazy-load client-side (next-page or infinite scroll) instead of rendering all 72 at once.
- Confirm the 72-volume cap is enforced server-side per org/user and can't be bypassed by switching context.
- Audit `/portfolio` and drop API calls that don't feed rendered data.
- Same rate-limit middleware as #1/#2 on this list endpoint.
- No rate limit currently stops mass duplication of buckets/volumes — even bounded by the 72 cap, an attacker can script duplication requests back-to-back to hit the cap instantly on every org, still churning DB writes and hitting the slow list endpoint repeatedly. Add a duplication-specific rate limit (e.g. 5/min) alongside the cap.

## 6. Dashboard pages fire unnecessary API requests

Same pattern as `/portfolio` (#5) shows up across multiple dashboard pages: on load they call APIs whose data isn't rendered anywhere on that page. This wastes backend capacity, slows perceived page load, and widens blast radius if any of those unrelated APIs are slow/down.

**Fix**
- Audit each dashboard page's network calls against what's actually rendered; remove calls to unused endpoints.
- Where data is shared across pages (e.g. nav/sidebar), fetch once at a layout level and cache/reuse instead of every page re-fetching independently.

---