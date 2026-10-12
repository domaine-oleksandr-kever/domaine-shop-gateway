import { applyParams, save, ActionOptions } from "gadget-server";
import { claimInstall } from "../../../lib/installs";
import { gatewayDefaults } from "../../../lib/shopDefaults";

export const run: ActionRun = async ({ params, record }) => {
  applyParams(params, record);
  Object.assign(record, gatewayDefaults(record));
  await save(record);
};

export const onSuccess: ActionOnSuccess = async ({ record, api, logger }) => {
  await claimInstall(api, logger, record);
};

export const options: ActionOptions = { actionType: "create" };
