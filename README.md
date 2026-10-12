# Domaine Shop Gateway

One remote MCP server that lets any Domaine employee ask any client Shopify store questions
from Claude Code or claude.ai, with a role per store and production stores read-only. Nobody
keeps Shopify tokens on a laptop, nobody logs into the Shopify CLI, and the rules live on the
server.

Status (2026-10-12): working prototype, deployed to the Gadget **production** environment, with three
dev stores. See [TODO / roadmap](#todo--roadmap) for what is still open and
[ARCHITECTURE.md](ARCHITECTURE.md) for the internals.

## What it is

| Part | Where | What it does |
|---|---|---|
| Gateway app | Gadget, app `domaine-shop-gateway` | Hosts the MCP endpoint `/mcp`, the admin page `/`, the store registry, roles, the GraphQL policy and the audit log |
| Shopify app | Dev Dashboard org "Domaine (North America)", apps `domaine-shop-gateway-dev` (development env) and `domaine-shop-gateway` (production env) | The key. Installing it on a store gives the gateway an offline Admin API token for that store. Shopify runs nothing else |
| Identity provider | WorkOS AuthKit, workspace `kever-sandbox`, environment Staging, domain `meaningful-pink-49-staging.authkit.app` | Google sign-in, OAuth 2.1 server for MCP clients and for the admin page |
| Clients | Claude Code (`claude mcp add`), claude.ai custom connector (same URL), Claude desktop through the connector | Call `stores`, `use_store`, `query`, `whoami` |

Production URL: `https://domaine-shop-gateway.gadget.app` (deployed 2026-10-12);
development URL (pauses when idle): `https://domaine-shop-gateway--development.gadget.app`.

## How authentication works

There are two logins with one identity.

1. **Into the gateway.** Every client (Claude Code, claude.ai, the admin page) authenticates
   against WorkOS AuthKit with OAuth 2.1 (authorization code + PKCE). AuthKit shows Google
   sign-in. The access token is a JWT with `iss` = the AuthKit domain and `aud` =
   `https://<gateway>/mcp` (the default "resource indicator" configured in WorkOS). The
   gateway verifies signature, issuer, audience and expiry with AuthKit's JWKS and never
   stores the token.
   - MCP clients discover the authorization server through the 401 response
     (`WWW-Authenticate: Bearer resource_metadata="…/oauth-protected-resource"`) and through
     `/.well-known/oauth-protected-resource`. They register themselves with Dynamic Client
     Registration or a Client ID Metadata Document; both are enabled in WorkOS.
   - The admin page uses a Client ID Metadata Document at `/gw/oauth-client` as its
     `client_id`; no client is registered in WorkOS by hand. The browser does the
     authorize redirect; the code and refresh exchanges go through `POST /gw/oauth/token`,
     because AuthKit's token endpoint sends no CORS header on the POST response.
   - The token carries only `sub`. On first sight of a `sub` the gateway calls AuthKit's
     userinfo endpoint with the same token and stores email and name in the `user` model.
     Emails outside `GATEWAY_ALLOWED_DOMAINS` (default `meetdomaine.com`) are rejected unless
     listed in `GATEWAY_ALLOWED_EMAILS`.
2. **Into a store.** The gateway holds one offline Admin API token per store, obtained when
   the Shopify app is installed on that store. Gadget stores it encrypted in `shopifyShop`.
   Each `query` call uses the token of the chosen store. Per-person rights come from the
   gateway's own roles, not from Shopify staff permissions.

## Roles and rules

| Role | Scope | Can |
|---|---|---|
| `read` | one store | run GraphQL `query` operations |
| `dev` | one store | `read` + a short list of mutations on **dev** stores only |
| `store-admin` | one store | `dev` + manage members, alias; appears on the store page |
| global `admin` | all stores | `store-admin` everywhere + enable/disable stores, set `env` |

- A store has `env` = `dev` or `prod` (from the Shopify plan at install time) and `enabled`.
  New dev stores are enabled at once; anything else waits for a global admin.
- **Prod stores are read-only**, whatever the role.
- Dev mutations allowed: `metafieldsSet`, `productUpdate`, `productCreate`,
  `metafieldDefinitionCreate`, `metaobjectCreate`, `metaobjectUpdate`, `publishablePublish`,
  `publishableUnpublish`. Everything else, introspection, subscriptions, batches and
  multi-operation documents are refused with the rule's name.
- Every `query` call and every admin change writes an `audit` row (who, store, operation
  name, allowed, reason, duration, query cost). Query text, variables and responses are never
  stored or logged.

## Use it from Claude Code

```
claude mcp add --transport http --scope user domaine-shop-gateway https://domaine-shop-gateway.gadget.app/mcp
```

Then in Claude Code run `/mcp`, choose `domaine-shop-gateway`, authenticate (browser, Google).
Ask things like "which stores can I use", "on kever-b2b, why does the engraving metafield
not show on Signet Ring". Tools: `whoami`, `stores`, `use_store(alias)`,
`query(query, variables?, store?)`.

## Use it from claude.ai (connector)

A Team Owner adds a custom connector once: Settings → Connectors → Add → URL
`https://<gateway>/mcp`. Each user authorizes with Google on first use. Connectors cannot be
edited later (remove and re-add), so create it on the production URL. The desktop app sees
the same connector.

## Add a store (self-serve)

1. Open `https://<gateway>/`, click **Sign in with Google** (a `@meetdomaine.com` account).
2. **Add store**: enter the handle or `<handle>.myshopify.com`. The gateway reserves the
   install for you (15 minutes) and sends you to Shopify's install page for the app. You need
   "Manage apps" on that store (owners of dev stores have it). A handle that Shopify does not
   know is refused at once ("store not found"). If you are not staff on the store, or the app
   cannot be installed there (a client store that is not a development store), Shopify
   refuses on its own page after you sign in; the gateway cannot check that beforehand. If
   Shopify does not open, the page shows the install link to click.
3. After you approve, the store appears in **My stores** with you as `store-admin`. Dev
   stores are enabled at once; prod stores show as disabled until a global admin enables them.
4. On the store page add members by email with a role. People who have not signed in yet
   get an invite that turns into access on their first sign-in.
5. Everyone then connects Claude Code with the command shown in the "Connect Claude Code" box.

If the install page cannot be opened from the gateway, the page shows how to install from
the Dev Dashboard; the claim still works by store domain.

## Operate it

### Environment variables (Gadget → Settings → Environment variables, or `ggt var set`)

| Name | Default | Purpose |
|---|---|---|
| `GATEWAY_ALLOWED_DOMAINS` | `meetdomaine.com` | Comma list of email domains allowed to sign in |
| `GATEWAY_ALLOWED_EMAILS` | empty | Comma list of individual addresses allowed besides the domains (e.g. a personal test account) |
| `GATEWAY_ADMIN_SUBS` | the owner's WorkOS `sub` | Comma list of WorkOS user ids that are global admins |
| `WORKOS_ISSUER` | the staging AuthKit domain | AuthKit domain; change when moving to a WorkOS production environment |
| `GATEWAY_BASE_URL` | derived from `GADGET_APP`/`GADGET_ENV`, else the dev URL | Public base URL used in metadata and the MCP resource |

No secrets are needed: JWT verification uses AuthKit's public JWKS and the Shopify token comes
from Gadget's connection.

### Commands

```
yarn install            # once
yarn test               # vitest: policy, validation, members, installs
npx tsc -p tsconfig.api.json --noEmit
npx -y ggt@latest push  # upload to the development environment
npx -y ggt@latest status / logs / var list
npx -y ggt@latest deploy  # development → production (after the checks below)
```

The development environment pauses after about 15 minutes idle (HTTP 540); `ggt push` or
`ggt status` wakes it. Use the production environment for anything people depend on.

### Shopify app scopes

Set in `shopify.app.development.toml` / `shopify.app.toml` (git-ignored, managed by Gadget):
products read/write, metaobjects read/write, metaobject definitions, themes, publications,
inventory, locations, markets (read). No orders or customers. Adding a scope requires every
installed store to re-approve the app once.

Gadget does not release TOML edits to Shopify by itself (the production deploy on 2026-10-12
left the app without scopes → `failed_grant_with_invalid_scopes` on install). After editing a
TOML, release it:

```
npx -y @shopify/cli@latest app deploy --config shopify.app.toml --allow-updates --no-build --message "scopes"
npx -y @shopify/cli@latest app deploy --config shopify.app.development.toml --allow-updates --no-build --message "scopes"
```

`shopify.app.toml` (production) is tracked in git and holds only the public client id;
`shopify.app.development.toml` is git-ignored by Gadget's template.

### WorkOS settings that must stay on

Connect → Configuration: **Dynamic Client Registration** and **Client ID Metadata Document**
enabled; MCP resource indicator `https://<gateway>/mcp` set as default. Authentication →
Providers: Google enabled.

## Demo data

`docs/demo-seed.md` holds the `query` tool calls that create the metafield definition
`custom.engraving` and three products (Signet Ring with engraving "Forever", Plain Band,
Hidden Pendant) on a dev store. Steps 1, 2, 3 and 5 ran on `kever-oleksandr-dev-store` and
`kever-b2b`; step 4 (publish) needs `write_publications`, which the app does not request.

## TODO / roadmap

Ordered by what the demo and the first users need.

1. ~~Verify the admin page sign-in, "Add store" and the store-admin claim~~ DONE 2026-10-12 on dev.
2. ~~Deploy to the Gadget production environment~~ DONE 2026-10-12. Still to do on production:
   install the production Shopify app `domaine-shop-gateway` on the stores, add the WorkOS
   resource indicator `https://domaine-shop-gateway.gadget.app/mcp` (default), sign in once on
   the production page; keep the dev URL for development only.
2a. **Show uninstalled stores** in `stores()` and on the page as "uninstalled — reinstall"
   instead of hiding them (roles and alias survive an uninstall; today the store just
   disappears until reinstalled).
3. ~~Add the claude.ai connector on the production URL and test from chat~~ DONE 2026-10-12 on a
   personal Pro account. Still to do: a Team Owner adds it for the Domaine organization.
4. **WorkOS production environment** with Domaine's own Google OAuth client (the Staging one
   uses WorkOS demo credentials) and Email + Password disabled.
4a. ~~Install diagnostics~~ DONE 2026-10-12: each `/gw/installs` call logs one `install request` line
   (`outcome`, `probe`, `durationMs`); read it with `npx -y ggt@latest logs --env production`
   when an "Add store" report comes in.
5. **Audit page polish**: request id per call, document hash, pagination beyond 250 rows,
   daily re-check of `env` against the Shopify plan.
6. **Hardening**: rate limit per user, `Origin` check on `/gw/*`, 409 on alias races,
   refresh tokens out of `sessionStorage`, App Bridge for the embedded Shopify admin view or a
   clean "not an embedded app" page.
7. **Scope trim**: remove the extra sub-scopes Gadget added (`unauthenticated_*`,
   `write_metaobject_definitions`, inventory shipments/transfers) or add `write_publications`
   deliberately.
8. **Prod stores**: define who may enable a prod store, and the per-store or per-Plus-org
   secondary app needed for paid stores (custom distribution = one store/org per app).
9. **Staff mode** (per-user 24 h online tokens that mirror Shopify staff permissions) for
   stores where Domaine must not hold an offline token.
10. **base plugin**: ship the GraphQL recipes skill and the server entry so every team gets
    the gateway without `claude mcp add`; Slack bot as a second client.
11. **Exit plan**: the Rust/Fly.io design in the owner's plan if Gadget's limits (Hobby: 0.5 GB,
    1-day logs, 500 req/10 s) or policy stop fitting.

## Repository map

```
api/lib/        auth (JWT), identity (userinfo, invites), roles, policy (+tests), shopify (Admin API call),
                mcp (tools), gw (admin route wrapper), members, installs, validate, audit, config
api/routes/     POST-mcp (MCP endpoint), GET-oauth-protected-resource, .well-known/*, gw/* (admin JSON API)
api/models/     user, access, pref, audit, invite, pendingInstall, shopifyShop (+alias/env/enabled)
web/            React Router v7 admin page: sign-in (PKCE), dashboard, store page
docs/           demo-seed.md
```
