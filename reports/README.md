# Scan report — Backend (PCShop API)

Result of the security analysis with ProjectDiscovery **Nuclei** against the
backend API. This document renders
[`backend-nuclei.jsonl`](./backend-nuclei.jsonl) in readable form.

## Summary

| | |
|---|---|
| Target | `http://host.docker.internal:4000` (Express 5 / Node 22) |
| Scope | unauthenticated, `http/` templates |
| Date | 2026-10-19, 00:15 UTC |
| Findings | **2**, both severity **`info`** |
| Real vulnerabilities (low/medium/high/critical) | **0** |

The backend is very well hardened. Its `helmet()` middleware already emits almost
every security header, so the scan only detects **two** minor gaps. The rest of
the result is "clean".

## Distribution

| Category | # | Severity |
|---|---:|---|
| Missing HTTP security headers | 2 | info |
| **Total** | **2** | |

## Detailed findings

### 1. Missing HTTP security headers (2) — *`http-missing-security-headers`*

| Missing header | What it does | Recommended value |
|---|---|---|
| `Permissions-Policy` | Restricts browser APIs (camera, microphone, geolocation…) | `camera=(), microphone=(), geolocation=()` |
| `Cross-Origin-Embedder-Policy` | Isolates cross-origin resource loads | `require-corp` |

Both can be added via `helmet()` (already in use) or with `res.setHeader(...)`.
Their impact is low: the API serves JSON, not HTML, so COEP/Permissions-Policy
have less surface than on a website.

**CWE-693** (Protection Mechanism Failure).

### What the backend DOES send (good)

The scan confirms the response includes, among others:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; ...; object-src 'none'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Permitted-Cross-Domain-Policies: none
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-XSS-Protection: 0
```

This matches what the backend README documents (`helmet()` +
`app.disable("x-powered-by")`).

## Scope notes

- The root `GET /` responds **`404 Not Found`** (there is no home page; this is an
  API). Nuclei continued the scan against that response.
- Without authentication, every `/api/*` endpoint except login responds
  **`401`**, so the business logic protected by JWT was **not evaluated** by
  Nuclei. This report covers the public surface (headers, reachable endpoints,
  server banner).

## Relation to the code

- `server.js` — where `helmet()` is registered; this is where the two missing
  headers would be added.
- `src/middleware/auth.js` and the `src/routes/*` routes — protected by JWT,
  out of scope without a token.

## Recommendations

1. Add `Permissions-Policy` and `Cross-Origin-Embedder-Policy`.
2. Optional: repeat an authenticated scan (with a valid token) if the protected
   API is to be covered; with Nuclei that requires supplying the
   `Authorization` header.

## Notice

Run active scans only against systems you own or are authorized to test. This
analysis was limited to a local lab environment.
