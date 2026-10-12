import { applyParams, save, ActionOptions } from "gadget-server";
import { preventCrossShopDataAccess } from "gadget-server/shopify";
import { claimInstall } from "../../../lib/installs";
import { gatewayFields } from "../../../lib/shopDefaults";

export const run: ActionRun = async ({ params, record }) => {
  const kept = gatewayFields(record);
  applyParams(params, record);
  Object.assign(record, kept);
  await preventCrossShopDataAccess(params, record);
  await save(record);
};

export const onSuccess: ActionOnSuccess = async ({ record, api, logger }) => {
  await claimInstall(api, logger, record);
};

export const options: ActionOptions = { actionType: "update" };
