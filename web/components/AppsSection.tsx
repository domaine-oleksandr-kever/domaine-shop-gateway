import { useId, useState, type FormEvent } from "react";
import { errorText, gwFetch } from "../lib/api";
import type { ShopApp } from "../lib/types";
import type { GwData } from "../lib/useGwData";

/** Global admin registry of the client Shopify apps added to Gadget's Shopify connection. */
export function AppsSection({ apps }: { apps: GwData<ShopApp[]> }) {
  const { data, error: loadError, reload } = apps;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (path: string, options: { method: string; body?: unknown }): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await gwFetch(path, options);
      reload();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const shown = error ?? loadError;
  return (
    <>
      {shown && (
        <p className="error" role="alert">
          {shown}
        </p>
      )}
      {!data ? (
        !loadError && <p className="muted">Loading apps…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Client id</th>
                <th scope="col">In Gadget</th>
                <th scope="col">Stores</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((app) => (
                <tr key={app.id}>
                  <td>{app.label}</td>
                  <td>
                    <code>{app.clientId}</code>
                  </td>
                  <td>{app.registeredInGadget ? "yes" : "no"}</td>
                  <td>{app.storeDomains.length ? app.storeDomains.join(", ") : <span className="muted">none</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={busy}
                      onClick={() => run(`/gw/apps/${app.id}`, { method: "DELETE" })}
                    >
                      Remove<span className="visually-hidden"> {app.label}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No apps registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <AddAppForm busy={busy} onAdd={(clientId, label) => run("/gw/apps", { method: "POST", body: { clientId, label } })} />
    </>
  );
}

function AddAppForm({ busy, onAdd }: { busy: boolean; onAdd: (clientId: string, label: string) => Promise<boolean> }) {
  const clientIdId = useId();
  const labelId = useId();
  const [clientId, setClientId] = useState("");
  const [label, setLabel] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onAdd(clientId.trim(), label.trim())) {
      setClientId("");
      setLabel("");
    }
  };

  return (
    <form className="row wrap add-member" onSubmit={submit} aria-label="Register app">
      <span className="field">
        <label htmlFor={clientIdId}>Client id</label>
        <input id={clientIdId} required autoComplete="off" spellCheck={false} value={clientId} onChange={(event) => setClientId(event.target.value)} />
      </span>
      <span className="field">
        <label htmlFor={labelId}>Label</label>
        <input id={labelId} required autoComplete="off" maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} />
      </span>
      <button type="submit" className="button" disabled={busy}>
        Register app
      </button>
    </form>
  );
}
