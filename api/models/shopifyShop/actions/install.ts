import { applyParams, save, ActionOptions } from "gadget-server";
import { gatewayDefaults } from "../../../lib/shopDefaults";

export const run: ActionRun = async ({ params, record }) => {
  applyParams(params, record);
  Object.assign(record, gatewayDefaults(record));
  await save(record);
};

export const options: ActionOptions = { actionType: "create" };
