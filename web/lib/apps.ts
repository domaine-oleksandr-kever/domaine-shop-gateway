import type { ShopApp } from "./types";

/** Apps whose label, client id or an installed store domain contains every word of the query, ignoring case. */
export function filterApps(apps: readonly ShopApp[], query: string): ShopApp[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return apps.filter((app) => {
    const text = [app.label, app.clientId, ...app.storeDomains].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
