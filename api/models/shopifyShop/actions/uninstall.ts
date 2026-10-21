import { applyParams, save, ActionOptions } from "gadget-server";
import { preventCrossShopDataAccess } from "gadget-server/shopify";
import { recordAdminEvent } from "../../../lib/audit";
import { probeInstalled } from "../../../lib/installState";
import { gatewayFields } from "../../../lib/shopDefaults";

export const run: ActionRun = async ({ params, record, connections, trigger, logger, api }) => {
  const kept = gatewayFields(record);
  applyParams(params, record);
  Object.assign(record, kept);
  await preventCrossShopDataAccess(params, record);

  // Shopify may deliver app/uninstalled minutes late, after the store has already reinstalled the app.
  const probe = await probeInstalled(connections.shopify, { id: record.id, myshopifyDomain: record.myshopifyDomain ?? "" });
  const context = { shopId: record.id, trigger: trigger.type, retries: "retries" in trigger ? trigger.retries : null };
  if (probe.state === "installed") {
    logger.warn(context, "stale app/uninstalled ignored: app still installed");
    await recordAdminEvent(api, logger, {
      userId: null,
      shopId: record.id,
      operationType: "uninstall-ignored",
      reason: `uninstall of ${record.myshopifyDomain ?? record.id} ignored: Shopify still accepts the app's token`,
    });
    return;
  }
  if (probe.state === "unknown") logger.warn({ ...context, reason: probe.reason }, "install probe failed, uninstalling anyway");
  await save(record);
};

// The Shopify probe can outlast the transaction timeout, after which `save` would throw and Gadget would retry the webhook.
export const options: ActionOptions = { actionType: "update", transactional: false };
