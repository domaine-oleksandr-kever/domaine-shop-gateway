import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";
import { z } from "zod";
import { recordAdminEvent } from "./audit";
import { HttpError } from "./httpError";
import type { GatewayUser } from "./identity";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

const PAGE = 250;

export interface AppView {
  id: string;
  clientId: string;
  label: string;
  /** The client id is among the apps in Gadget's Shopify connection, so installs through it work. */
  registeredInGadget: boolean;
  /** Installed shops whose install went through this app. */
  storeDomains: string[];
}

const Body = z.strictObject({ clientId: z.string().trim().min(1), label: z.string().trim().min(1).max(100) });

/** Checks a registration body; the client id must already be an app in Gadget's Shopify connection. */
export function parseAppInput(body: unknown, apiKeys: readonly string[]): { clientId: string; label: string } {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "body must be { clientId, label }");
  if (!apiKeys.includes(parsed.data.clientId)) {
    throw new HttpError(400, "add the app in Gadget first: Settings → Plugins → Shopify");
  }
  return parsed.data;
}

export function appViews(
  apps: { id: string; clientId: string | null; label: string | null }[],
  shops: { myshopifyDomain: string | null; installedViaApiKey: string | null }[],
  apiKeys: readonly string[]
): AppView[] {
  return apps.map((app) => {
    const clientId = app.clientId ?? "";
    return {
      id: app.id,
      clientId,
      label: app.label ?? "",
      registeredInGadget: apiKeys.includes(clientId),
      storeDomains: shops
        .filter((shop) => shop.myshopifyDomain && shop.installedViaApiKey === clientId)
        .map((shop) => shop.myshopifyDomain!),
    };
  });
}

export async function listApps(api: Api, apiKeys: readonly string[]): Promise<AppView[]> {
  const apps = await api.shopApp.findMany({ sort: { label: "Ascending" }, select: { id: true, clientId: true, label: true }, first: PAGE });
  const clientIds = apps.map((app) => app.clientId).filter((id): id is string => !!id);
  const shops = clientIds.length
    ? await api.shopifyShop.findMany({
        filter: { installedViaApiKey: { in: clientIds }, state: { inState: "created.installed" } },
        select: { myshopifyDomain: true, installedViaApiKey: true },
        first: PAGE,
      })
    : [];
  return appViews(apps, shops, apiKeys);
}

export async function registerApp(
  api: Api,
  logger: Logger,
  user: GatewayUser,
  input: { clientId: string; label: string }
): Promise<{ id: string }> {
  const existing = await api.shopApp.maybeFindFirst({ filter: { clientId: { equals: input.clientId } }, select: { id: true } });
  if (existing) throw new HttpError(409, "this app is already registered");
  const app = await api.shopApp.create({ ...input, createdBy: { _link: user.id } });
  await recordAdminEvent(api, logger, {
    userId: user.id,
    shopId: null,
    operationType: "app-registered",
    reason: `app ${input.clientId} registered as ${input.label}`,
  });
  return { id: app.id };
}

export async function removeApp(api: Api, logger: Logger, user: GatewayUser, id: string): Promise<void> {
  const app = await api.shopApp.maybeFindFirst({ filter: { id: { equals: id } }, select: { id: true, clientId: true } });
  if (!app) throw new HttpError(404, "app not found");
  await api.shopApp.delete(app.id);
  await recordAdminEvent(api, logger, {
    userId: user.id,
    shopId: null,
    operationType: "app-removed",
    reason: `app ${app.clientId} removed`,
  });
}
