import { useState } from "react";
import { Link } from "react-router";
import { errorText, gwFetch } from "../lib/api";
import type { Store } from "../lib/types";
import { EnvBadge } from "./Badges";

/** Global admin view of stores that wait for approval or were switched off. */
export function DisabledStores({ stores, onChange }: { stores: Store[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const disabled = stores.filter((store) => !store.enabled);

  const enable = async (store: Store) => {
    setBusyId(store.id);
    setError(null);
    try {
      await gwFetch(`/gw/stores/${store.id}`, { method: "PATCH", body: { enabled: true } });
      onChange();
    } catch (failure) {
      setError(errorText(failure));
    }
    setBusyId(null);
  };

  if (disabled.length === 0) return <p className="muted">Every store is enabled.</p>;
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="plain-list">
        {disabled.map((store) => (
          <li key={store.id} className="row spread">
            <span>
              <Link to={`/stores/${store.id}`}>{store.alias}</Link> <EnvBadge env={store.env} />{" "}
              <span className="muted small">installed {new Date(store.installedAt).toLocaleDateString()}</span>
            </span>
            <button type="button" className="button secondary" disabled={busyId === store.id} onClick={() => enable(store)}>
              Enable {store.alias}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
