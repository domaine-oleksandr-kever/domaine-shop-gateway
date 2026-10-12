import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "pendingInstall" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "GT0biDUTFR5o",
  fields: {
    expiresAt: {
      type: "dateTime",
      includeTime: true,
      validations: { required: true },
      storageKey: "apqbkHQ_1AlD",
    },
    shopDomain: {
      type: "string",
      validations: { required: true, unique: true },
      storageKey: "7LVBn-Kxn7Ws",
    },
    user: {
      type: "belongsTo",
      validations: { required: true },
      parent: { model: "user" },
      storageKey: "otx6KoHzPhjH",
    },
  },
};
