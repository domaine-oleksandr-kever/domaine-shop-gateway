import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "access" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "vwT5flKCCwOS",
  fields: {
    role: {
      type: "enum",
      acceptMultipleSelections: false,
      acceptUnlistedOptions: false,
      options: ["read", "dev", "store-admin"],
      validations: { required: true },
      storageKey: "bPz6DgKPLrxH",
    },
    shop: {
      type: "belongsTo",
      validations: { required: true },
      parent: { model: "shopifyShop" },
      storageKey: "B4BOwUzrDu7O",
    },
    user: {
      type: "belongsTo",
      validations: {
        required: true,
        unique: { scopeByField: "shop" },
      },
      parent: { model: "user" },
      storageKey: "lV_kfhGrbAfj",
    },
  },
};
