# Architecture

Last updated 2026-10-12 (install probe and admin API timeouts; admin page sign-in shared by tabs). Update this file in the same change that
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
5. `shopify.ts` gets the store token from `connections.shopify.getAccessToken({ shopId })`
   and POSTs to `https://<shop>/admin/api/2026-10/graphql.json` with a 25 s timeout. One
   retry with a fresh token on 401. The response `{ data, errors, extensions.cost }` is
   returned as text, capped at 45,000 characters (`{ truncated, bytes, hint, preview }`).
6. An `audit` row is written for every call, allowed or refused, before the result returns.

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

1. `POST /gw/installs { shop }` → `validate.ts` normalizes the domain → `probeShop`
   (`installs.ts`) sends one `HEAD https://<shop>/` without following redirects, 8 s timeout:
   404 → "store not found"; a timeout or network failure does not block → `pendingInstall`
   row (unique per domain, 15 min) → returns the Shopify install URL
   `https://<shop>/admin/oauth/install?client_id=<app key>` (key from
   `connections.shopify.apiKeys`; never in git) or manual instructions. Each call logs one
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

## Data model

| Model | Key fields | Notes |
|---|---|---|
| `user` | `sub` (unique), `email`, `name`, `globalRole` none/admin, `lastSeenAt` | one row per WorkOS user |
| `access` | `user`, `shop`, `role` read/dev/store-admin | unique per (user, shop) via `scopeByField` |
| `invite` | `email`, `shop`, `role`, `invitedBy` | unique per (email, shop); redeemed on first sign-in |
| `pref` | `user` (unique), `currentShop` | the `use_store` selection |
| `pendingInstall` | `user`, `shopDomain` (unique), `expiresAt` | 15-minute reservation |
| `audit` | `user?`, `shop?`, `tool`, `operationType`, `operationName`, `allowed`, `reason`, `durationMs`, `cost` | never query text, variables or responses |
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
  refused before any Shopify call.
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
`localStorage`; App Bridge removed from the embedded admin view.
