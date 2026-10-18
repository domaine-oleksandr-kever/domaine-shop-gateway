import { describe, expect, it } from "vitest";
import { appViews, parseAppInput } from "./apps";
import { HttpError } from "./httpError";

const keys = ["main-key", "client-key"];

function refusal(run: () => unknown): HttpError {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpError) return error;
  }
  throw new Error("expected an HttpError");
}

describe("parseAppInput", () => {
  it("trims both fields", () => {
    expect(parseAppInput({ clientId: " client-key ", label: "  Acme  " }, keys)).toEqual({ clientId: "client-key", label: "Acme" });
  });

  it("refuses a client id Gadget does not know", () => {
    const error = refusal(() => parseAppInput({ clientId: "other", label: "Acme" }, keys));
    expect(error.status).toBe(400);
    expect(error.message).toBe("add the app in Gadget first: Settings → Plugins → Shopify");
  });

  it("refuses blank fields, unknown fields and non-objects", () => {
    for (const body of [{ clientId: "client-key", label: "  " }, { clientId: "", label: "Acme" }, { clientId: "client-key", label: "Acme", extra: 1 }, null]) {
      expect(refusal(() => parseAppInput(body, keys)).status).toBe(400);
    }
  });
});

describe("appViews", () => {
  it("marks apps Gadget knows and lists the stores installed through each", () => {
    const apps = [
      { id: "1", clientId: "client-key", label: "Acme" },
      { id: "2", clientId: "gone-key", label: "Old" },
    ];
    const shops = [
      { myshopifyDomain: "acme.myshopify.com", installedViaApiKey: "client-key" },
      { myshopifyDomain: "dev.myshopify.com", installedViaApiKey: "main-key" },
      { myshopifyDomain: null, installedViaApiKey: "client-key" },
    ];
    expect(appViews(apps, shops, keys)).toEqual([
      { id: "1", clientId: "client-key", label: "Acme", registeredInGadget: true, storeDomains: ["acme.myshopify.com"] },
      { id: "2", clientId: "gone-key", label: "Old", registeredInGadget: false, storeDomains: [] },
    ]);
  });
});
