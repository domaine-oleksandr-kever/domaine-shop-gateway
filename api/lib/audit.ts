import type { api as gadgetApi, logger as gadgetLogger } from "gadget-server";

type Api = typeof gadgetApi;
type Logger = typeof gadgetLogger;

export interface AdminEvent {
  /** The acting user; null for system events such as an install nobody claimed. */
  userId: string | null;
  shopId: string | null;
  operationType: string;
  /** Short human text; names other people by record id, never by email. */
  reason: string;
}

/** Writes one `tool: "admin"` audit row; a failed write is logged so it never undoes the change it describes. */
export async function recordAdminEvent(api: Api, logger: Logger, event: AdminEvent): Promise<void> {
  try {
    await api.audit.create({
      user: event.userId ? { _link: event.userId } : undefined,
      shop: event.shopId ? { _link: event.shopId } : undefined,
      tool: "admin",
      operationType: event.operationType,
      allowed: true,
      reason: event.reason,
    });
  } catch (error) {
    logger.error({ reason: error instanceof Error ? error.name : "unknown" }, "admin audit write failed");
  }
}
