# pcshop-backend

REST API for the PC components dashboard. **Every** product operation requires a
JWT issued by this service, presented as a Bearer token.

This is the **second repo** of the deliverable. The compose file that boots the
whole stack also lives here, because it has to reference the other two.

| | |
|---|---|
| Stack | Node 22, Express 5, `pg`, `jsonwebtoken`, `ldapjs` |
| Local URL | <http://localhost:4000> |
| Sibling repos | [`pcshop-frontend`](../pcshop-frontend) · [`pcshop-ldap`](../pcshop-ldap) |

## The auth flow

```
Browser ──POST /api/auth/login {username,password}──▶ this service
                                                        │
                                          1. search the directory as
                                             svc-pcshop (does the user exist?)
                                          2. direct bind as the user
                                                (LDAP checks the password)
                                                        │
        ◀── { token, user } ────────────────────────────┘
                (HS256, sub=handle, exp=5m)

Browser ──GET /api/products  Authorization: Bearer <jwt>──▶ requireAuth
                                                              │
                                        jwt.verify(signature, exp,
                                        issuer, audience, alg=HS256)
                                                              │
                                                              ▼
                                                    req.auth = claims
```

Two design points worth pointing out in a demo:

- **The service account cannot mint tokens.** `svc-pcshop` can only *search*.
  Validating a password requires binding as the user with their own DN.
- **`created_by` comes from `req.auth.handle`**, never from the request body. A
  client cannot attribute a row to somebody else, and the column is a direct
  consequence of having verified the token.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Liveness + database reachability (compose healthcheck) |
| POST | `/api/auth/login` | — | LDAP bind → JWT. Body: `{ username, password }` |
| GET | `/api/auth/me` | Bearer | Echoes the verified claims; used to validate a stored token on boot |
| GET | `/api/categories` | Bearer | The category vocabulary the form needs |
| GET | `/api/products` | Bearer | Listing. Optional `?category=` and `?q=` (matches name or brand) |
| GET | `/api/products/:id` | Bearer | Single product |
| POST | `/api/products` | Bearer | Create. `422` with a per-field `errors[]` on invalid input |
| DELETE | `/api/products/:id` | Bearer | Delete, `204` on success |

Error bodies are always `{ error, code }`; validation failures add `errors[]`.
The `code` values are stable and safe to branch on: `NO_BEARER_TOKEN`,
`TOKEN_EXPIRED`, `TOKEN_INVALID`, `USER_NOT_FOUND`, `BAD_PASSWORD`,
`LDAP_UNAVAILABLE`, `VALIDATION_ERROR`, `INVALID_CATEGORY`, `NOT_FOUND`.

Tokens are short lived (`JWT_EXPIRES_IN`, `5m` by default), so a lapsed one is
an ordinary, expected outcome rather than a malfunction. A single `401` is all a
client needs to recognise:

- The server distinguishes the two ways a token can be unusable. `TOKEN_EXPIRED`
  is a token this service minted, whose `exp` has passed, and the client's stored
  session can simply be discarded and replaced. `TOKEN_INVALID` means the token is
  not one this service can vouch for (wrong secret, bad signature, wrong
  issuer/audience), which is a different and more serious signal.
- The browser drops the session and returns to the login screen with the reason
  it ended, on both counts: a request answered with `401 TOKEN_EXPIRED`, and a
  click on a link after `exp` has passed, which issues no request and so can only
  be caught by reading `exp` locally.
- `401 TOKEN_EXPIRED` is deliberately *not* used for a failed login, so a wrong
  password cannot be mistaken for an ended session.

## Run it

```powershell
cp .env.example .env
# set a real signing secret — the server refuses to boot on a placeholder
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up -d --build
```

The three repos must be siblings:

```
290926_persistant_jwt/
|-- pcshop-backend/     <- this repo, compose lives here
|-- pcshop-frontend/
`-- pcshop-ldap/
```

| Servicio | Host | Notas |
|---|---|---|
| frontend | http://localhost:8081 | nginx, reverse-proxies `/api` here |
| backend | http://localhost:4000 | also reachable directly for curl |
| db | localhost:5434 | Postgres 16, `pcshop` database |
| ldap | localhost:1389 | OpenLDAP, `dc=lab,dc=local` |

Ports avoid colliding with the previous LDAP-integration project (8080 / 3000 /
5433 / 389).

### Local development without Docker

```powershell
npm install
npm run dev     # nodemon-style reload
```

You still need a reachable Postgres and LDAP; point `DATABASE_URL` and
`LDAP_URL` at them in `.env`.

## Smoke test

```powershell
# 1. Log in (juan / LabPass-@juan) and capture the token
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/auth/login `
          -ContentType 'application/json' `
          -Body '{"username":"juan","password":"LabPass-@juan"}'
$token = $login.token

# 2. Use it
Invoke-RestMethod -Uri http://localhost:4000/api/products -Headers @{ Authorization = "Bearer $token" }

# 3. Show that a missing / broken token is rejected
Invoke-RestMethod -Uri http://localhost:4000/api/products          # 401 NO_BEARER_TOKEN
Invoke-RestMethod -Uri http://localhost:4000/api/products -Headers @{ Authorization = "Bearer not.a.jwt" }  # 401 TOKEN_INVALID
```

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | **yes** | — | ≥32 chars, non-placeholder. Boot fails otherwise |
| `JWT_EXPIRES_IN` | no | `5m` | Anything `jsonwebtoken` accepts (`30m`, `2h`, `7d`) |
| `JWT_ISSUER` | no | `pcshop-api` | Verified on every request |
| `JWT_AUDIENCE` | no | `pcshop-frontend` | Verified on every request |
| `DATABASE_URL` | **yes** | local Postgres | |
| `LDAP_URL` | no | `ldap://127.0.0.1:389` | |
| `LDAP_SVC_DN` / `LDAP_SVC_PASSWORD` | yes / no | `cn=svc-pcshop,…` / `SvcPcshop-@2026` | Search-only account |
| `LDAP_PEOPLE_OU` | no | `ou=People,${LDAP_BASE_DN}` | |

## Security notes

- `jwt.verify` is pinned to `algorithms: ["HS256"]`. Without that whitelist a
  token whose header claims `alg: none` reaches the verifier instead of being
  rejected.
- `iss` and `aud` are both checked, so a token minted for a different service
  (or a leftover one from a previous run with a rotated secret) is refused.
- LDAP filter values are escaped per RFC 4515, so a handle typed into the login
  form cannot alter the search filter.
- Every SQL statement is parameterized; no value is ever concatenated into SQL.
- `helmet()` sets the standard security headers; `app.disable("x-powered-by")`
  hides the stack hint.

## Known issue

`ldapjs@3.0.7` is published as **decommissioned** upstream. It works and matches
what the previous project used, but the maintained successor is `ldapts`
(async/iterator API, not callbacks). Tracked as a follow-up; see
`src/middleware/ldapAuth.js` for the single file that would change.
