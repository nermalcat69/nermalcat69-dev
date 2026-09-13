# Performance/DoS Issue: Storage Volume Duplication Causes Unbounded Page Load

**Area:** Storage volumes list, `/portfolio`

---

## Problem

Duplicating a single storage entry repeatedly ran until hitting a **hard cap of 72 volumes**. Even bounded at 72, the volumes page becomes extremely slow to render:

- Page load time increases to **~14–15 seconds**.
- All 72 volume entities are fetched and rendered **in one shot** — pagination is not implemented (or not enforced) on the volumes list, so the client loads every entity regardless of how many exist.
- Because the whole entity set loads unbounded, hitting this same API harder (concurrent requests, or growing the entity count further if the cap is per-user/org and can be multiplied across orgs) increases response payload size and server load — i.e. the missing pagination turns a normal "heavy API" into a **DoS amplification vector**: cheap to trigger, expensive to serve.

Separately, the `/portfolio` page fires a number of API calls that don't correspond to anything rendered on that page — unnecessary requests fired on every page load regardless of relevance.

---

## Observed Behavior

- Duplicating one volume up to the 72-volume cap.
- Volumes list page load: **~14–15s**, all 72 entities returned/rendered at once, no page-size limiting.
- `/portfolio`: triggers multiple APIs unrelated to the data actually shown on that page.

---

## Risks

| Risk | Impact |
|------|--------|
| **DoS amplification** | No pagination means every list request pays the full O(n) cost; repeating/duplicating requests against this endpoint scales load faster than request count. |
| **Poor UX / perceived outage** | 14–15s load times on a core page will read as broken/hung to normal users, not just attackers. |
| **Unnecessary load on unrelated services** | `/portfolio` calling APIs it doesn't need wastes backend capacity and increases blast radius when those APIs are slow or rate-limited. |

---

## Recommendations

| Fix | Implementation |
|-----|----------------|
| **Server-side pagination** | Volumes list endpoint should accept `limit`/`cursor` (or `page`) params and return a bounded page, not the full entity set. |
| **Client-side pagination** | Render only the current page of volumes; lazy-load/paginate on scroll or explicit "next page" instead of fetching all 72 at once. |
| **Cap awareness** | Since a 72-volume cap already exists, confirm it's enforced server-side per relevant scope (user/org) and not bypassable by switching context. |
| **Trim `/portfolio` requests** | Audit and remove API calls on `/portfolio` that don't feed anything rendered on that page. |
| **Rate limiting on heavy list APIs** | Apply rate limits to list endpoints so unpaginated/heavy requests can't be replayed to amplify load. |

---

## Severity

**Medium–High** — No exploitation beyond normal usage is required to degrade the page (14–15s load at just 72 items), and the lack of pagination means the same endpoint could be leveraged for load amplification.

---

## Affected Areas

- Storage volumes list API/page (duplication reached 72-volume cap)
- `/portfolio` page (unnecessary API calls)
