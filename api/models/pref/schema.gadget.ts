import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "pref" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "sNjDiVKo8hMr",
  fields: {
    currentShop: {
      type: "belongsTo",
      parent: { model: "shopifyShop" },
      storageKey: "drawZbHPjD0x",
    },
    user: {
      type: "belongsTo",
      validations: { required: true, unique: true },
      parent: { model: "user" },
      storageKey: "7QUgioP4zcJ_",
    },
  },
};
