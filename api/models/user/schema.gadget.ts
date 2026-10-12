import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "user" model, go to https://domaine-shop-gateway.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "KCrWvrVcbEzi",
  fields: {
    email: { type: "email", storageKey: "Ugqz9Y-l0Tgz" },
    globalRole: {
      type: "enum",
      default: "none",
      acceptMultipleSelections: false,
      acceptUnlistedOptions: false,
      options: ["none", "admin"],
      validations: { required: true },
      storageKey: "UP2mcU5AV9nh",
    },
    lastSeenAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "uKHrgXISglQ-",
    },
    name: { type: "string", storageKey: "kZzpZRGCxYvx" },
    sub: {
      type: "string",
      validations: { required: true, unique: true },
      storageKey: "Yt1vMafvhsMi",
    },
  },
};
