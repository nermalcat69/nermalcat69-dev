# Device Management for Login Sessions: Contextual Session Binding & Theft Detection

**Date:** 2026-09-09  
**Status:** Draft


## 0. Goal

Enable device tracking for logins so that, for security reasons, we keep a per-user history of which devices signed in, from where, and when — including sessions that have since expired or been revoked.

The primary threat this addresses is **session token theft**. Many info-stealer trojans specifically exfiltrate session cookies/keys so an attacker can replay a valid login from their own machine without needing the password. By binding each session to the network and device context it was created in (via Cloudflare geolocation headers and User-Agent), we can detect when a stolen token is replayed from a different device or location.

When that mismatch is detected, the user is not silently blocked. They are shown a "new location / new device" notice and asked to re-authenticate by clicking **Send magic login email**, which delivers a one-time login link to their registered address. Legitimate users (travel, new network, new laptop) recover in one click; an attacker holding only a stolen cookie cannot complete the email step.

## 1. Executive Summary

This report describes an architecture that relies entirely on **Cloudflare's native IP geolocation headers**, which are injected automatically into every request to your origin server.

**Key insight:** The geolocation data arrives pre-attached to every request header at **zero additional cost** and with **zero additional API calls**.


## 2. Core Defense Mechanism: Contextual Session Binding

### 2.1. The Threat: Session Token Theft

Password theft is increasingly bypassed in favour of stealing an already-authenticated session. If an attacker obtains a valid session cookie, they are logged in as the victim — no password, no MFA prompt, nothing else required. This is the primary attack this architecture is designed to detect.

### 2.2. How the Theft Occurs

**From browsers (Chromium-based):**

Infostealers such as LummaC2, Vidar, RedLine, and StealC search the user-data directories of installed browsers to extract cookies, saved passwords, and stored OAuth tokens. The stolen cookie data is then used to reconstruct session cookies, letting the attacker impersonate the user without going through normal authentication.

More sophisticated malware such as AmnesiaStealer goes further: it copies the victim's **entire Chromium browser profile** (including authentication state) and loads it into a hidden, headless browser on the infected machine, so the attacker's requests carry the victim's full cookie jar and local state.

In every case the attacker's traffic still originates from **their own machine and network** — a different IP, ASN, city, and device than the session was created on. That is the drift this design detects.

### 2.3. The Defense: Contextual Session Binding

We statically bind each Better Auth session to a set of attributes observed at the time of **initial authentication**. Later requests on that session token are checked against this baseline; a material drift is treated as a risk signal (see §7, Verification Logic).

**Bound attributes (the baseline):**

| Group | Attributes | Source |
| :--- | :--- | :--- |
| **Network** | IP address, ASN (Autonomous System Number), Country, City | `CF-Connecting-IP`, `CF-IPCountry`, `CF-City` headers; ASN from the Workers `request.cf.asn` object |
| **Device** | Opaque `device_id` (random, server-generated — never derived from client input), lightweight Browser/OS fingerprint | Server-generated UUID; User-Agent parsing |

**Storage location:** server-side only, in the dedicated `security_sessions` table. Never in `localStorage` or client-readable cookies — the client is fully untrusted and can forge or replay any value it can see. The session token in the HttpOnly cookie is the only client-held artifact, and it carries no security context of its own.

> ASN is a useful discriminator for token theft: a stolen cookie replayed from a hosting provider or residential-proxy network will usually present a different ASN than the user's home ISP or mobile carrier, even when the coarse country still matches.

## 3. Prerequisites: Enable Cloudflare IP Geolocation

Before any geolocation data becomes available, you must enable the feature in your Cloudflare dashboard:

1. Log in to your [Cloudflare account](https://dash.cloudflare.com) and select your domain
2. Navigate to **Network** in the sidebar
3. For **IP Geolocation**, toggle the switch to **On**

**Alternative (Recommended):** Enable the **"Add visitor location headers" Managed Transform** for full location data (city, region, continent, latitude, longitude). This is available on **all Cloudflare plans** (Free, Pro, Business, Enterprise).

> **Note:** `CF-IPCountry` is available on all plans. City, region, and other detailed fields are available on **Pro plans and above**. Check your plan's capabilities.


## 4. Available Cloudflare Geolocation Headers

Once enabled, Cloudflare adds the following headers to every request sent to your origin:

| Header | Description | Example |
| :--- | :--- | :--- |
| `CF-Connecting-IP` | **The visitor's real IP address** (critical — Cloudflare's IP is *not* used) | `103.xxx.xxx.xxx` |
| `CF-IPCountry` | Two-letter ISO country code | `IN`, `US`, `DE` |
| `CF-Region` | Region or state name | `Karnataka`, `California` |
| `CF-Region-Code` | Subdivision code | `KA`, `CA` |
| `CF-City` | City name | `Bangalore`, `San Francisco` |
| `CF-Postal-Code` | Postal/ZIP code | `560001`, `94107` |
| `CF-Timezone` | Local timezone of the visitor | `Asia/Kolkata`, `America/New_York` |
| `CF-Continent` | Continent code | `AS`, `NA`, `EU` |
| `CF-Latitude` | Approximate latitude | `12.9716` |
| `CF-Longitude` | Approximate longitude | `77.5946` |

> **Important:** `CF-Connecting-IP` contains the **real visitor IP**, not Cloudflare's data center IP. Always use this header for the client's IP address.


## 5. Core Data Entities

### 5.1. The `devices` Table (Browser & OS Context)

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Primary Key | `dev_01J...` |
| `user_id` | UUID | Foreign Key to Users Table | `usr_001` |
| `device_name` | VARCHAR | User-defined or auto-generated name | `MacBook Pro` |
| `browser_family` | VARCHAR | Browser engine or name | `Chrome`, `Firefox`, `Safari` |
| `browser_version` | VARCHAR | Major/minor version | `140.0.0` |
| `os_family` | VARCHAR | Operating system | `macOS`, `Windows`, `Linux` |
| `os_version` | VARCHAR | OS version string | `15.5` |
| `device_type` | VARCHAR | Form factor | `desktop`, `mobile`, `tablet` |
| `timezone` | VARCHAR | IANA timezone string (from Cloudflare) | `Asia/Kolkata` |
| `first_seen_at` | TIMESTAMP | First registration timestamp | `2026-09-09T10:00:00Z` |
| `last_seen_at` | TIMESTAMP | Last active timestamp | `2026-09-09T14:00:00Z` |

### 5.2. The `security_sessions` Table (Network & IP Context)

This table stores the **Cloudflare-provided geolocation data** bound to each Better Auth session.

| Field | Type | Description | Source | Example |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Primary Key | — | `sec_abc123` |
| `better_auth_session_id` | UUID | References `session.id` in Better Auth | — | `ba_sess_xyz` |
| `user_id` | UUID | Foreign Key to Users Table | — | `usr_001` |
| `device_id` | UUID | Foreign Key to `devices` table | — | `dev_01J...` |
| `bound_ip` | INET | The IP address at login (the baseline) | `CF-Connecting-IP` | `103.xxx.xxx.xxx` |
| `bound_asn` | INTEGER | Autonomous System Number at login | `request.cf.asn` (Workers) | `24560` |
| `bound_country` | CHAR(2) | ISO country code | `CF-IPCountry` | `IN` |
| `bound_region` | VARCHAR(100) | Region/state name | `CF-Region` | `Karnataka` |
| `bound_region_code` | VARCHAR(10) | Subdivision code | `CF-Region-Code` | `KA` |
| `bound_city` | VARCHAR(100) | City name | `CF-City` | `Bangalore` |
| `bound_postal` | VARCHAR(20) | Postal/ZIP code | `CF-Postal-Code` | `560001` |
| `bound_timezone` | VARCHAR(50) | Timezone | `CF-Timezone` | `Asia/Kolkata` |
| `bound_continent` | CHAR(2) | Continent code | `CF-Continent` | `AS` |
| `current_ip` | INET | IP of the most recent request | `CF-Connecting-IP` | `103.xxx.xxx.xxx` |
| `current_asn` | INTEGER | ASN of the most recent request | `request.cf.asn` (Workers) | `24560` |
| `current_city` | VARCHAR(100) | City of the most recent request | `CF-City` | `Bangalore` |
| `last_verified_at` | TIMESTAMP | Timestamp of last security check | — | `2026-09-09T14:05:00Z` |
| `expires_at` | TIMESTAMP | Absolute session expiry (e.g., 8 hours) | — | `2026-09-09T18:00:00Z` |
| `is_revoked` | BOOLEAN | Flag for revoked/compromised sessions | — | `false` |
| `created_at` | TIMESTAMP | Session creation timestamp | — | `2026-09-09T10:00:00Z` |

### 5.3. The `security_audit_log` Table (Forensic Trail)

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary Key |
| `user_id` | UUID | Foreign Key to Users Table |
| `session_id` | UUID | References `security_sessions` |
| `event_type` | VARCHAR(50) | `SESSION_BOUND`, `IP_VERIFIED`, `MISMATCH_BLOCKED`, `REVOKED` |
| `request_ip` | INET | IP from `CF-Connecting-IP` |
| `request_asn` | INTEGER | ASN from `request.cf.asn` |
| `request_country` | VARCHAR(2) | Country from `CF-IPCountry` |
| `request_region` | VARCHAR(100) | Region from `CF-Region` |
| `request_city` | VARCHAR(100) | City from `CF-City` |
| `decision` | VARCHAR(20) | `ALLOW`, `STEP_UP`, `BLOCK` |
| `metadata` | JSONB | Extra context (e.g., mismatch reason) |
| `created_at` | TIMESTAMP | Log timestamp |


## 6. Data Ingestion Flow

**Step 1 — Login & browser/OS capture**

1. Browser sends the login request to Cloudflare.
2. Cloudflare forwards it to the backend API, injecting the geolocation headers:
   `CF-Connecting-IP: 103.x.x.x`, `CF-IPCountry: IN`, `CF-Region: Karnataka`, `CF-City: Bangalore`, `CF-Timezone: Asia/Kolkata` (ASN from `request.cf.asn`).
3. API parses the User-Agent and stores/retrieves the `devices` record.

**Step 2 — Session binding (no external API calls)**

4. API creates the `security_sessions` record from the request context:
   `bound_ip = CF-Connecting-IP`, `bound_asn = request.cf.asn`, `bound_country = CF-IPCountry`, `bound_region = CF-Region`, `bound_city = CF-City`, `bound_timezone = CF-Timezone`.
5. API returns the Better Auth session token as an HttpOnly cookie.


## 7. Verification Logic (The Guardrail)

The preferred UX is **step-up authentication rather than immediately blocking a user** when the current request appears to originate from a materially different location.

This is especially useful for dashboard access, where a legitimate user may change networks, travel, or use a different connection. The system should treat geolocation as a **risk signal**, not as proof that an account has been compromised.

### 7.1. Detect a Suspicious Login / Session

When a request is received:

1. **Fetch Context:** Retrieve the relevant `security_sessions` record using the current `better_auth_session_id`
2. **Extract Current Data:** Read Cloudflare headers from the current request:
   - `CF-Connecting-IP` → current IP
   - `CF-IPCountry` → current country
   - `CF-Region` → current region/state
   - `CF-City` → current city
3. **Compare against the stored `bound_*` values**
4. If the location/context is materially different, mark the request as requiring **step-up authentication**
5. Do not trust `localStorage` or any browser-controlled value for this decision

### 7.2. Suspicious Location Component

When a login/session is considered suspicious, show a security component in the dashboard rather than silently failing the request.

Example UI:

> **It looks like you're accessing your account from a new location.**  
> We detected a sign-in from **Bangalore, Karnataka, India** that doesn't match your recent session.
>
> To verify that this is you, we'll send a login link to your registered email address.

**Button:** `Send email for login`

The component should:

- Clearly explain why verification is required
- Display only the location information that is appropriate to expose to the user
- Provide a single explicit action such as **Send email for login**
- Avoid revealing sensitive internal security signals such as risk scores, fingerprint values, or internal detection rules
- Rate-limit email requests
- Avoid allowing the browser to bypass the verification requirement
- Keep the verification state server-side

### 7.3. Email Step-Up Flow

1. Browser sends a login/dashboard request; Cloudflare forwards it with geolocation headers injected.
2. API retrieves the existing session/device context and compares the current location against the bound baseline.

**If location/context is normal:**

3. API continues the request normally.

**If location/context is suspicious:**

3. API creates a step-up verification challenge (server-side).
4. API returns the "new location" verification component to the browser.
5. User clicks **Send email for login**.
6. API sends a one-time login verification link to the registered email address.
7. User opens the link; API validates and consumes the challenge.
8. API marks the session/context as verified and continues to the dashboard.

### 7.4. Verification Decisions

| Scenario | Current Context vs Bound Session | Decision |
| :--- | :--- | :--- |
| **Normal** | IP/City/Region is consistent | **Allow** |
| **IP changes, same city** | IP changes but location remains consistent | **Allow** |
| **New city/region** | Material location change | **STEP-UP** → Show email verification component |
| **New country** | Significant location change | **STEP-UP** → Require email login verification |
| **Session age > 4 hours** | Sensitive action | Require re-authentication |
| **Session age > 8 hours** | Any action | Session expired — Force login |
| **Verification succeeds** | Challenge is valid and unused | **Allow** + record verification |
| **Verification fails/expires** | Invalid, expired, or consumed challenge | **BLOCK** |

4. **Audit:** Log the request and decision in `security_audit_log`

### 7.5. Security Properties of the Email Challenge

The email login challenge should be:

- **One-time use**
- **Short-lived** (for example, 10–15 minutes)
- Bound to the intended user/account
- Stored server-side as a hashed token or equivalent secure representation
- Invalidated immediately after successful use
- Rate-limited to prevent email abuse
- Protected against replay
- Recorded in `security_audit_log`

The browser should never be able to set a client-side value such as `verified=true` and bypass the check.

### 7.6. Recommended User Flow

```text
User signs in
      │
      ▼
Cloudflare provides request location
      │
      ▼
Backend compares against session/device context
      │
      ├── Normal ───────────────► Continue
      │
      ▼
New / suspicious location
      │
      ▼
Show:
"It looks like you're accessing your account
 from a new location."
      │
      ▼
[ Send email for login ]
      │
      ▼
Email verification link
      │
      ▼
User opens link
      │
      ▼
Backend validates one-time challenge
      │
      ├── Valid ────────────────► Mark verified → Continue
      │
      └── Invalid/expired ──────► Block
```

> **Important:** A location mismatch should not automatically be treated as proof of account takeover. IP geolocation is an estimate and can change because of mobile networks, ISP routing, corporate networks, VPNs, proxies, or travel. Use the mismatch to trigger a stronger authentication step rather than relying on geolocation alone.


## 8. Critical Implementation Rules

### A. Always Use the Real Client IP
Cloudflare proxies your traffic, so `REMOTE_ADDR` will show Cloudflare's IP address, not the visitor's. **Always use `CF-Connecting-IP`** for the client's real IP. Never trust `X-Forwarded-For` blindly.

### B. Server-Side Source of Truth
- **DO NOT** store `bound_country`, `bound_city`, or `bound_ip` in `localStorage`
- All security attributes reside strictly in the `security_sessions` table on the backend
- The client is untrusted and can manipulate localStorage

### C. No External API Calls
This approach requires **zero external API calls**:
- Geolocation data is pre-attached to every request
- No rate limits to worry about
- No additional cost (included in your Cloudflare plan)
- Lower latency (no round-trip to an external service)

### D. Accuracy and Limitations
IP geolocation is an **estimate, not an exact science**:
- IP addresses rotate and ownership can change
- Cloudflare updates its database multiple times per week
- For compliance-critical use cases, do not rely solely on IP geolocation

**Correction process:** If you find an incorrect IP location, submit a correction via Cloudflare's [data correction form](https://www.cloudflare.com/lp/ip-corrections/).

### E. Data Minimization (GDPR / SOC 2)
We collect only:
- **Network context:** IP, Country, Region, City (from Cloudflare headers)
- **Device context:** Browser family, OS family (from User-Agent)

This is significantly easier to justify under data protection regulations than full browser fingerprinting (Canvas/WebGL).


## 9. Summary of Focus Areas

| Category | Data Points Collected | Source | Storage Location |
| :--- | :--- | :--- | :--- |
| **Browser/OS (Stable)** | Browser family, Browser version, OS family, OS version, Device type | User-Agent parsing | `devices` table |
| **Network/Context (Dynamic)** | Client IP, Country, Region, City, Postal Code, Timezone, Continent | Cloudflare headers (`CF-*`) | `security_sessions` table |
| **Operational** | Better Auth Session ID, Expiry times, Revocation flag | — | `security_sessions` table |
| **Audit** | All verification attempts, decisions, and mismatches | Cloudflare headers + decision logic | `security_audit_log` table |

