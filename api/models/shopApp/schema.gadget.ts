import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "shopApp" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "0bf4SnSHUppl",
  fields: {
    clientId: {
      type: "string",
      validations: { required: true, unique: true },
      storageKey: "bWJo5v-tAO1i",
    },
    createdBy: {
      type: "belongsTo",
      validations: { required: true },
      parent: { model: "user" },
      storageKey: "e__wIHWx1CxH",
    },
    label: {
      type: "string",
      validations: { required: true },
      storageKey: "V9msbFepYVtd",
    },
  },
};
