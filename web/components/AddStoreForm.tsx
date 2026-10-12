import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText, gwFetch } from "../lib/api";
import type { InstallStart } from "../lib/types";

export function AddStoreForm() {
  const inputId = useId();
  const hintId = useId();
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Extract<InstallStart, { manual: true }> | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setOpening(null);
      setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setManual(null);
    setOpening(null);
    try {
      const result = await gwFetch<InstallStart>("/gw/installs", { method: "POST", body: { shop } });
      if ("installUrl" in result) {
        setOpening(result.installUrl);
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
          {opening ? "Opening Shopify…" : busy ? "Starting…" : "Install app"}
        </button>
      </div>
      <p id={hintId} className="muted small">
        You need the Manage apps permission on the store. Approve the install within 15 minutes and you become its
        store-admin. Development stores are enabled at once; other stores wait for a global admin. If you are not staff on
        the store, or the app cannot be installed there (for example a client store that is not a development store),
        Shopify refuses on its own page after you sign in: the gateway cannot check that beforehand.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {opening && (
        <p className="notice" role="status">
          If Shopify does not open, use <a href={opening}>this link</a>.
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
