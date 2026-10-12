import { deleteRecord, ActionOptions } from "gadget-server";

export const run: ActionRun = async ({ record }) => {
  await deleteRecord(record);
};

export const options: ActionOptions = { actionType: "delete" };
