import { useId, useState, type FormEvent } from "react";
import { errorText, gwFetch } from "../lib/api";
import type { InstallStart } from "../lib/types";

export function AddStoreForm() {
  const inputId = useId();
  const hintId = useId();
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Extract<InstallStart, { manual: true }> | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setManual(null);
    try {
      const result = await gwFetch<InstallStart>("/gw/installs", { method: "POST", body: { shop } });
      if ("installUrl" in result) {
        window.location.assign(result.installUrl);
        return;
      }
      setManual(result);
    } catch (failure) {
      setError(errorText(failure));
    }
    setBusy(false);
  };

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor={inputId}>Store handle or domain</label>
      <div className="row">
        <input
          id={inputId}
          name="shop"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="my-store or my-store.myshopify.com"
          aria-describedby={hintId}
          value={shop}
          onChange={(event) => setShop(event.target.value)}
        />
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Starting…" : "Install app"}
        </button>
      </div>
      <p id={hintId} className="muted small">
        You need the Manage apps permission on the store. Approve the install within 15 minutes and you become its
        store-admin. Development stores are enabled at once; other stores wait for a global admin.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {manual && (
        <div className="notice" role="status">
          <p>{manual.instructions}</p>
          <a href={manual.devDashboardUrl} target="_blank" rel="noopener">
            Open the Shopify Dev Dashboard
          </a>
        </div>
      )}
    </form>
  );
}
