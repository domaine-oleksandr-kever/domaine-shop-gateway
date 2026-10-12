import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "audit" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "XHj8cHbXz0_I",
  fields: {
    allowed: {
      type: "boolean",
      default: false,
      storageKey: "8HnWacRSQ3e5",
    },
    cost: { type: "json", storageKey: "C3VHW-qWMTZ3" },
    durationMs: {
      type: "number",
      decimals: 0,
      storageKey: "AdqsdbT0v5VZ",
    },
    operationName: { type: "string", storageKey: "vWolvIbj9lNl" },
    operationType: { type: "string", storageKey: "Kr6--zxckr7R" },
    reason: { type: "string", storageKey: "QizgyeDqyI5n" },
    shop: {
      type: "belongsTo",
      parent: { model: "shopifyShop" },
      storageKey: "dkWTLpvYiGEI",
    },
    tool: {
      type: "string",
      validations: { required: true },
      storageKey: "NQ7uIcJBjzwx",
    },
    user: {
      type: "belongsTo",
      parent: { model: "user" },
      storageKey: "oZ3kwU2SDsJj",
    },
  },
};
