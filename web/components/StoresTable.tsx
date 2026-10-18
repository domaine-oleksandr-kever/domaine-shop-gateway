import { useState } from "react";
import { Link } from "react-router";
import { ApiError, errorText, gwFetch } from "../lib/api";
import type { Store } from "../lib/types";
import { EnabledText, EnvBadge } from "./Badges";

export function StoresTable({ stores, globalAdmin, onChange }: { stores: Store[]; globalAdmin: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ store: Store; message: string; installed: boolean } | null>(null);

  const remove = async (store: Store) => {
    setBusy(true);
    setFailure(null);
    try {
      await gwFetch(`/gw/stores/${store.id}`, { method: "DELETE" });
      onChange();
    } catch (error) {
      const message = errorText(error);
      setFailure({ store, message, installed: error instanceof ApiError && error.status === 409 && message.includes("still installed") });
    }
    setBusy(false);
  };

  if (stores.length === 0) return <p className="muted">No stores yet. Add one below, or ask a store-admin to add you.</p>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Alias</th>
              <th scope="col">Domain</th>
              <th scope="col">Env</th>
              <th scope="col">Status</th>
              <th scope="col">Your role</th>
              {globalAdmin && (
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.id}>
                <td>{store.installed ? <Link to={`/stores/${store.id}`}>{store.alias}</Link> : store.alias}</td>
                <td>{store.domain}</td>
                <td>
                  <EnvBadge env={store.env} />
                </td>
                <td>{store.installed ? <EnabledText enabled={store.enabled} /> : <span className="muted">Uninstalled</span>}</td>
                <td>{store.role}</td>
                {globalAdmin && (
                  <td>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={`Delete ${store.alias}`}
                      disabled={busy}
                      onClick={() => remove(store)}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failure && (
        <p className="error" role="alert">
          {failure.message}
          {failure.installed && (
            <>
              {" "}
              <a
                href={`https://admin.shopify.com/store/${failure.store.domain.replace(/\.myshopify\.com$/i, "")}/settings/apps`}
                target="_blank"
                rel="noopener"
              >
                Open the store's apps page
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}
