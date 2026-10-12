import { applyParams, save, ActionOptions } from "gadget-server";

export const run: ActionRun = async ({ params, record }) => {
  applyParams(params, record);
  await save(record);
};

export const options: ActionOptions = { actionType: "create" };
