# Architecture

Last updated 2026-10-14 (pre-send schema validation and the `validate` tool). Update this file in the same change that
alters a flow, a model or a trust boundary.

## Components

```
 Claude Code ──┐                               ┌──────────────── Gadget app ────────────────┐
 claude.ai  ───┼── OAuth 2.1 (PKCE) ──► WorkOS │  POST /mcp ──► auth ──► tools ──► policy   │
 desktop app ──┘        ▲                AuthKit│      │                              │      │
                        │ JWKS / userinfo       │  identity ◄──┘            shopify.ts fetch  │──► Shopify Admin
 admin page (web/) ─────┘                       │  /gw/* admin JSON API     (token per store) │    GraphQL 2026-10
                                                │  models: user access pref audit invite      │
                                                │          pendingInstall shopifyShop         │
                                                └─────────────────────────────────────────────┘
                                                                 ▲
                                        Shopify app install ─────┘ (offline token → shopifyShop)
```

- **WorkOS AuthKit** is the only authorization server. It owns sign-in (Google), client
  registration (DCR and Client ID Metadata Documents), token issuing and JWKS. The gateway
  trusts tokens whose `iss` is the AuthKit domain and whose `aud` is the gateway's MCP URL.
- **Gadget** hosts the code, the Postgres database behind the models, the Shopify
  connection (install flow, token storage, webhooks `shop/update`, `app/uninstalled`) and
  the React Router frontend.
- **Pre-send check** between policy and `shopify.ts`: `preflight.ts` validates an allowed
  document with `graphql-validate.ts` against the Admin schema cached by `schema.ts`.
- **Shopify** sees only one app per environment. The app has no UI of its own; the embedded
  admin view shows a link to the gateway.

## Request flow: a `query` tool call

1. Client sends `POST /mcp` (Streamable HTTP, JSON only, stateless) with `Authorization: Bearer <jwt>`.
2. `api/routes/POST-mcp.ts` → `verifyBearer` (`api/lib/auth.ts`): `jose.jwtVerify` with the
   remote JWKS, issuer and audience from `config.ts`, `sub` required. Failure → 401 with
   `WWW-Authenticate: Bearer … resource_metadata="<base>/oauth-protected-resource"`.
3. A fresh `McpServer` + `StreamableHTTPServerTransport` per request (`api/lib/mcp.ts`).
   Tools resolve the user lazily once per request: `resolveUser` (`identity.ts`) loads the
   `user` by `sub`, calls AuthKit userinfo when email is unknown, applies the allowed-domain
   rule, grants `globalRole=admin` to subs in `GATEWAY_ADMIN_SUBS`, redeems pending invites.
4. `query` resolves the store (`store` alias or `pref.currentShop`), computes the effective
   role (`roles.ts`: global admin → store-admin everywhere, else the `access` row), checks
   `enabled`, then runs the **policy** (`policy.ts`, pure, unit-tested):
   parse → exactly one operation → no subscription → `query` without introspection, or
   `mutation` only if `env=dev`, role ∈ {dev, store-admin} and every root field is in the
   allow-list → forward `{ query: print(ast), variables }` only.
4a. **Pre-send validation** (`preflight.ts`), unless `GATEWAY_VALIDATE=0`. `schema.ts` returns
   the Admin schema built with `buildClientSchema`, cached at module level (one per instance)
   keyed by the API version, 24 h TTL. A miss runs the gateway's own introspection
   (`getIntrospectionQuery({ descriptions: false, inputValueDeprecation: true })`, so deprecated
   arguments and input fields stay in the schema; the calling store's token, 10 s timeout)
   through `runAdminGraphql`, not through the client policy; concurrent misses share one load,
   the JSON is dropped after the build, and each load logs one line (`admin schema loaded`:
   `version`, `types`, `fetchMs`, `buildMs`, `rssMb`). A failed load logs `admin schema
   unavailable`; the previous schema, if any, stays in use, and that store's token is not used
   for another load for 5 min (other stores may still load, so one revoked token does not
   switch validation off for everyone). `graphql-validate.ts` then runs graphql-js
   `validate` (specified rules) on the client's own text, re-parsed so line:column match what
   was sent, plus `getVariableValues` for the variables. Errors → refusal
   `invalid document: <up to 3 problems with line:column>`, audit reason `invalid`, nothing
   sent. `NoDeprecatedCustomRule` hits ride along as `warnings` in the result. **Fail-open**:
   no schema → the document is sent unchecked and the result carries `validated: false`
   (Shopify rejects an invalid document itself, so the check saves a round trip, it is not a
   safety gate).
5. `shopify.ts` gets the store token from `connections.shopify.getAccessToken({ shopId })`
   and POSTs to `https://<shop>/admin/api/2026-10/graphql.json` with a 25 s timeout. One
   retry with a fresh token on 401. The response `{ data, errors, extensions.cost }` is
   returned as text, capped at 45,000 characters (`{ truncated, bytes, hint, preview }`).
6. An `audit` row is written for every call, allowed or refused, before the result returns.

## Request flow: a `validate` tool call

Steps 1–4 as for `query` (same identity, variables, store and policy checks); when the policy
allows, the 4a schema check runs and its errors and warnings go into the answer instead of a
refusal; a policy refusal skips the schema check (`validated: false`) and comes back inside the
JSON, not as a tool error. The answer is
`{ valid, validated, policy: { allowed, reason }, operationType, operationName, errors, warnings }`
as JSON text; `valid` is true only when the policy allows and the schema check ran with no
errors. Nothing is sent to Shopify. Audited with `tool: "validate"`; `allowed` is what `query`
would audit for the same document (policy allows and no schema errors), reason `invalid` on
schema errors.

## Request flow: the admin page

- `web/lib/auth.ts` runs authorization code + PKCE against AuthKit with
  `client_id` = `https://<base>/gw/oauth-client` (a Client ID Metadata Document served by the
  app), `redirect_uri` = `<base>/auth/callback`, `scope = openid profile email offline_access`
  and `resource = <base>/mcp`, so the token's `aud` matches what `/mcp` expects.
- The authorize redirect runs in the browser. The code exchange and the refresh go through
  `POST /gw/oauth/token` (`api/routes/gw/oauth/POST-token.ts`), which adds `client_id` (and
  `resource` for the code grant), forwards the form to AuthKit's `/oauth2/token` and returns
  its status and JSON unchanged, never logged: AuthKit answers the CORS preflight but sends
  no `Access-Control-Allow-Origin` on the POST, so a browser fetch fails.
- Tokens live in `localStorage` (`gw.tokens`), so every tab of the browser is signed in;
  `web/lib/api.ts` refreshes once on 401 (a refresh that fails because another tab already
  rotated the refresh token uses that tab's tokens). The PKCE flow record (`gw.oauth-flow`)
  stays in the `sessionStorage` of the tab that started the flow.
- A tab without tokens starts the authorize redirect by itself once (`gw.auto-signin` in
  `sessionStorage`, so a failing callback cannot loop) and shows "Signing you in…"; AuthKit's
  own session cookie returns a code without the Google screen. The callback returns to the
  path the sign-in started from (`returnTo`, e.g. `/stores/<id>`). After that one attempt, or
  after an error, the page shows the "Sign in with Google" button.
- "Sign out" drops the tokens and sets `gw.signed-out` in `localStorage`: every tab then shows
  the button, without signing in by itself, until the next sign-in by hand clears it.
- Ceiling: tokens in `localStorage` are readable by any script on the origin. The upgrade
  is an httpOnly session cookie issued by `/gw/oauth/token`.
- Every `/gw/*` route goes through `api/lib/gw.ts`: same `verifyBearer`, same `resolveUser`,
  then a role check per route, JSON errors (`httpError.ts`), audit rows with `tool: "admin"`.

## Store onboarding (self-serve)

1. `POST /gw/installs { shop, clientId? }` (`clientId` for global admins only: a production
   store's own client app) → `validate.ts` normalizes the domain → `resolveClientId`
   (`installs.ts`) picks the app: the requested `clientId`, refused with 400 unless it is in
   `connections.shopify.apiKeys`; else the main app (`GATEWAY_DEFAULT_CLIENT_ID`, default the
   `client_id` of `shopify.app.toml`) when Gadget knows it; else the only key → `probeShop`
   (`installs.ts`) sends one `HEAD https://<shop>/` without following redirects, 8 s timeout:
   404 → "store not found"; a timeout or network failure does not block → `pendingInstall`
   row (unique per domain, 15 min, with the chosen `clientId`) → returns the Shopify install URL
   `https://<shop>/admin/oauth/install?client_id=<client id>`, or manual instructions when no
   app was picked. Each call logs one
   `install request` line: domain, `outcome` (reserved / exists-404 / already-installed /
   conflict), `probe` (exists / missing / timeout / unreachable) and `durationMs`
   (`ggt logs --env production`).
   The page then shows "Opening Shopify…" with the install URL as a fallback link and
   navigates there. Whether the user is staff on the store and whether the app can be
   installed there (custom distribution, non-dev store) only Shopify knows: it refuses on its
   own page. Every admin API call from the page gives up after 20 s with a readable error.
2. Shopify runs the OAuth install; Gadget's connection stores the offline token and calls
   the `shopifyShop.install` action.
3. `install.ts` → `shopDefaults.ts` sets `env` from the plan (`partner_test`, `development`,
   "… App Development" display names → `dev`; else `prod`), `enabled = env === "dev"`,
   `alias` = handle; `installs.ts` claims a live `pendingInstall` → `access(user, shop,
   store-admin)`; unclaimed installs are audited and stay as the defaults.
4. `reinstall` / `uninstall` keep alias, env and enabled.
5. `GET /gw/installs` lists the caller's reservations, active and expired (a global admin sees
   everyone's, with user and `clientId`); the page polls it every 30 s while one is active.
   `DELETE /gw/installs/:shop` removes an expired one for its owner or a global admin; an
   active one answers 409, since another user may have taken it over.
6. Client apps for production stores (`apps.ts`, `shopApp` model), all global admin only:
   `GET /gw/apps` lists them; each row carries `registeredInGadget` (the `clientId` is in
   `connections.shopify.apiKeys`) and `storeDomains` (installed shops whose
   `shopifyShop.installedViaApiKey` is that `clientId`). `POST /gw/apps { clientId, label }`
   answers 400 unless `clientId` is in `connections.shopify.apiKeys` ("add the app in Gadget
   first") and 409 for a `clientId` already registered. `DELETE /gw/apps/:id` removes one
   (404 when missing). Both writes are audited as `app-registered` / `app-removed`.
   `GET /gw/config` returns `shopifyApp { appUrl, oauthCallbackUrl, scopes }`, the values the
   Dev Dashboard form needs.

## Data model

| Model | Key fields | Notes |
|---|---|---|
| `user` | `sub` (unique), `email`, `name`, `globalRole` none/admin, `lastSeenAt` | one row per WorkOS user |
| `access` | `user`, `shop`, `role` read/dev/store-admin | unique per (user, shop) via `scopeByField` |
| `invite` | `email`, `shop`, `role`, `invitedBy` | unique per (email, shop); redeemed on first sign-in |
| `pref` | `user` (unique), `currentShop` | the `use_store` selection |
| `pendingInstall` | `user`, `shopDomain` (unique), `expiresAt`, `clientId?` | 15-minute reservation; `clientId` is the app the install link was built for |
| `shopApp` | `clientId` (unique), `label` | client Shopify apps a global admin registered after adding them to Gadget's Shopify connection |
| `audit` | `user?`, `shop?`, `tool` (query/validate/admin), `operationType`, `operationName`, `allowed`, `reason`, `durationMs`, `cost` | never query text, variables or responses |
| `shopifyShop` | Gadget's shop fields + `alias` (unique), `env` dev/prod, `enabled` | token held by Gadget's connection |

## Trust boundaries

- **No external API access.** `accessControl/permissions.gadget.ts` grants `unauthenticated`
  and `shopify-app-users` nothing on the gateway models; `shopify-app-users` lost
  `shopifyShop.update` so an embedded-app session cannot flip `env`/`enabled`. All reads and
  writes go through routes that run with the internal `api` client after bearer + role checks.
- **Tokens.** WorkOS access tokens are verified and discarded; Shopify tokens never leave
  `shopify.ts`; nothing secret is in git (`shopify.app.*.toml`, `.gadget/` are ignored).
- **Policy is an allow-list** on the parsed AST, not a regex deny-list; batches, extra
  operations, `operationName`/`extensions` from the client and non-object variables are
  refused before any Shopify call. The gateway's own schema introspection bypasses that policy
  (it is not a client document); the introspection JSON stays in `schema.ts`, and clients'
  introspection is still refused. Validation messages may name schema types and fields (public
  in Shopify's docs), so `validate` is not an introspection bypass of anything secret.
- **Prod is read-only by construction.** The mutation branch requires `env === "dev"`.
- **Logging.** Only reason categories (expired, claim, signature, …) and claim names are
  logged, never values.

## Environments and URLs

| | Development | Production |
|---|---|---|
| Gadget URL | `https://domaine-shop-gateway--development.gadget.app` | `https://domaine-shop-gateway.gadget.app` |
| Shopify app | `domaine-shop-gateway-dev` | `domaine-shop-gateway` |
| WorkOS | Staging environment, resource indicator = dev `/mcp` | Production environment, own Google client |
| Pauses when idle | yes (15 min) | no |
| State | development only | live since 2026-10-12 |

## Known limits of the current build

See README → TODO / roadmap. In short: sign-in of the admin page not yet verified in a
browser; dev environment pauses; 250-row pages; no rate limiting; tokens in
`localStorage`; App Bridge removed from the embedded admin view; the Admin schema cache is per
instance, so the first `query`/`validate` after a cold start pays one introspection load
(upgrade path: a `scheduler` action that warms the cache, or the introspection JSON persisted
in a model); no pre-send "required scopes" hint, because standard introspection carries no
scope data.
