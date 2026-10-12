import { applyParams, save, ActionOptions } from "gadget-server";
import { preventCrossShopDataAccess } from "gadget-server/shopify";
import { gatewayFields } from "../../../lib/shopDefaults";

export const run: ActionRun = async ({ params, record }) => {
  const kept = gatewayFields(record);
  applyParams(params, record);
  Object.assign(record, kept);
  await preventCrossShopDataAccess(params, record);
  await save(record);
};

export const options: ActionOptions = { actionType: "update" };
