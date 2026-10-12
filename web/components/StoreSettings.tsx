import { useId, useState, type FormEvent } from "react";
import { errorText, gwFetch } from "../lib/api";
import type { Store, StoreEnv } from "../lib/types";

interface Props {
  store: Store;
  globalAdmin: boolean;
  onChange: () => void;
}

/** Alias for store-admins; env and enabled for global admins. */
export function StoreSettings({ store, globalAdmin, onChange }: Props) {
  const aliasId = useId();
  const envId = useId();
  const enabledId = useId();
  const [alias, setAlias] = useState(store.alias);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (changes: Partial<Pick<Store, "alias" | "enabled" | "env">>) => {
    setBusy(true);
    setError(null);
    try {
      await gwFetch(`/gw/stores/${store.id}`, { method: "PATCH", body: changes });
      onChange();
    } catch (failure) {
      setError(errorText(failure));
    }
    setBusy(false);
  };

  const saveAlias = (event: FormEvent) => {
    event.preventDefault();
    void save({ alias: alias.trim() });
  };

  return (
    <div className="stack">
      <form className="stack" onSubmit={saveAlias}>
        <label htmlFor={aliasId}>Alias</label>
        <div className="row">
          <input
            id={aliasId}
            required
            pattern="[a-z0-9\-]{2,40}"
            title="2 to 40 characters: a-z, 0-9 and -"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
          />
          <button type="submit" className="button secondary" disabled={busy || alias.trim() === store.alias}>
            Save alias
          </button>
        </div>
      </form>
      {globalAdmin && (
        <div className="row">
          <label htmlFor={envId}>Env</label>
          <select id={envId} value={store.env} disabled={busy} onChange={(event) => void save({ env: event.target.value as StoreEnv })}>
            <option value="dev">dev</option>
            <option value="prod">prod</option>
          </select>
          <input
            id={enabledId}
            type="checkbox"
            role="switch"
            checked={store.enabled}
            disabled={busy}
            onChange={(event) => void save({ enabled: event.target.checked })}
          />
          <label htmlFor={enabledId}>Enabled</label>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
