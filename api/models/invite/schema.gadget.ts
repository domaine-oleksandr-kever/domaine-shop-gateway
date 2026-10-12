import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "invite" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "G30qvobPLHHc",
  fields: {
    email: {
      type: "email",
      validations: {
        required: true,
        unique: { scopeByField: "shop" },
      },
      storageKey: "KPgNpd2PUOSC",
    },
    invitedBy: {
      type: "belongsTo",
      parent: { model: "user" },
      storageKey: "3evEBcRy5zT-",
    },
    role: {
      type: "enum",
      acceptMultipleSelections: false,
      acceptUnlistedOptions: false,
      options: ["read", "dev", "store-admin"],
      validations: { required: true },
      storageKey: "98R0FHW4FW2V",
    },
    shop: {
      type: "belongsTo",
      validations: { required: true },
      parent: { model: "shopifyShop" },
      storageKey: "bwv3R6Ngp1PP",
    },
  },
};
