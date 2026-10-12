import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "session" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "gsEeEvln-LFo",
  fields: {
    roles: {
      type: "roleList",
      default: ["unauthenticated"],
      storageKey: "ghVwTow71mkU",
    },
  },
  shopify: { fields: { shop: true, shopifySID: true } },
};
