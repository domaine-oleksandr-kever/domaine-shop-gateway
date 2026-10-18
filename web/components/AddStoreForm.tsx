import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText, gwFetch } from "../lib/api";
import { filterApps } from "../lib/apps";
import { loadConfig } from "../lib/auth";
import { AppsSection } from "./AppsSection";
import type { GatewayConfig, InstallStart, ShopApp } from "../lib/types";
import type { GwData } from "../lib/useGwData";

const GADGET_EDITOR_URL = "https://domaine-shop-gateway.gadget.app/edit";

type StoreKind = "dev" | "prod";

/**
 * Starts a store install. A development store installs the main app at once; a production store (global admins only)
 * needs its own client app, so that tab walks through creating one and builds an install link to hand over.
 * `onInstallChange` runs when an install was started, or when the page comes back from Shopify through history.
 * `apps` is the registry step 4 of that tab edits, so an app registered there shows in the picker at once.
 */
export function AddStoreForm({
  globalAdmin,
  apps,
  onInstallChange,
}: {
  globalAdmin: boolean;
  apps: GwData<ShopApp[]>;
  onInstallChange: () => void;
}) {
  const kindName = useId();
  const inputId = useId();
  const hintId = useId();
  const [kind, setKind] = useState<StoreKind>("dev");
  const [shop, setShop] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Extract<InstallStart, { manual: true }> | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [link, setLink] = useState<{ shop: string; url: string } | null>(null);
  const prod = globalAdmin && kind === "prod";

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setOpening(null);
      setBusy(false);
      onInstallChange();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [onInstallChange]);

  const switchKind = (next: StoreKind) => {
    setKind(next);
    setError(null);
    setManual(null);
    setLink(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (prod && !clientId) {
      setError("Choose the client's app first.");
      return;
    }
    setBusy(true);
    setError(null);
    setManual(null);
    setOpening(null);
    setLink(null);
    try {
      const body = prod ? { shop, clientId } : { shop };
      const result = await gwFetch<InstallStart>("/gw/installs", { method: "POST", body });
      onInstallChange();
      if ("installUrl" in result && prod) {
        setLink({ shop: result.shop, url: result.installUrl });
      } else if ("installUrl" in result) {
        setOpening(result.installUrl);
        window.location.assign(result.installUrl);
        return;
      } else {
        setManual(result);
      }
    } catch (failure) {
      setError(errorText(failure));
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      {globalAdmin && (
        <fieldset className="row">
          <legend>Store type</legend>
          <label>
            <input type="radio" name={kindName} checked={kind === "dev"} onChange={() => switchKind("dev")} /> Development
            store
          </label>
          <label>
            <input type="radio" name={kindName} checked={kind === "prod"} onChange={() => switchKind("prod")} /> Production
            store
          </label>
        </fieldset>
      )}
      {prod && <ProductionSteps apps={apps} clientId={clientId} onClientIdChange={setClientId} />}
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
            {opening ? "Opening Shopify…" : busy ? "Starting…" : prod ? "Generate install link" : "Install app"}
          </button>
        </div>
        <p id={hintId} className="muted small">
          {prod
            ? "The link reserves the store for you for 15 minutes: if it is opened later, the store still arrives but nobody becomes its store-admin."
            : "You need the Manage apps permission on the store and must approve the install within 15 minutes to become its store-admin. Shopify refuses a store that is not a development store on its own page."}
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
        {link && (
          <div className="notice stack" role="status">
            <p>
              Install link for {link.shop}. Send it to a person with Manage apps on the store, or{" "}
              <a href={link.url} target="_blank" rel="noopener">
                open it
              </a>{" "}
              yourself.
            </p>
            <CopyValue label="Install link" value={link.url} />
          </div>
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
    </div>
  );
}

function ProductionSteps({
  apps,
  clientId,
  onClientIdChange,
}: {
  apps: GwData<ShopApp[]>;
  clientId: string;
  onClientIdChange: (clientId: string) => void;
}) {
  const [app, setApp] = useState<GatewayConfig["shopifyApp"] | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then(
      (config) => setApp(config.shopifyApp),
      (failure) => setConfigError(`Could not load the app values: ${errorText(failure)}`)
    );
  }, []);

  return (
    <ol className="stack">
      <li>
        In the Shopify Dev Dashboard, create an app named <code>gateway-&lt;client&gt;</code> with these values:
        {configError && (
          <span className="error" role="alert">
            {" "}
            {configError}
          </span>
        )}
        {app && (
          <span className="stack">
            <a className="button" href={app.devDashboardUrl} target="_blank" rel="noopener">
              Open the Dev Dashboard
            </a>
            <CopyValue label="App URL" value={app.appUrl} />
            <CopyValue label="Redirect URL" value={app.oauthCallbackUrl} />
            <CopyValue label="Scopes" value={app.scopes.join(", ")} />
          </span>
        )}
      </li>
      <li>
        Choose distribution <strong>Custom</strong> and enter the client's store domain or Plus organization. This choice
        is permanent.
      </li>
      <li>
        Add the app's client id and secret in Gadget:{" "}
        <a href={GADGET_EDITOR_URL} target="_blank" rel="noopener">
          Settings → Plugins → Shopify
        </a>
        .
      </li>
      <li>
        Register the app here:
        <AppsSection apps={apps} />
      </li>
      <li>
        Pick it here and generate the install link:
        <AppPicker apps={apps} clientId={clientId} onChange={onClientIdChange} />
      </li>
      <li>
        A person with Manage apps on the client store opens the link. The store arrives as production and disabled until a
        global admin enables it; it is read-only.
      </li>
    </ol>
  );
}

function AppPicker({
  apps: { data: apps, error },
  clientId,
  onChange,
}: {
  apps: GwData<ShopApp[]>;
  clientId: string;
  onChange: (clientId: string) => void;
}) {
  const searchId = useId();
  const selectId = useId();
  const [query, setQuery] = useState("");

  if (error || !apps) return null;
  if (apps.length === 0) return <p className="muted">No app yet: register one in step 4.</p>;

  const shown = filterApps(apps, query);
  const search = (next: string) => {
    setQuery(next);
    if (!filterApps(apps, next).some((app) => app.clientId === clientId)) onChange("");
  };

  return (
    <span className="row wrap">
      <span className="field">
        <label htmlFor={searchId}>Search apps</label>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Label, client id or store"
          value={query}
          onChange={(event) => search(event.target.value)}
        />
      </span>
      <span className="field">
        <label htmlFor={selectId}>App</label>
        <select id={selectId} value={clientId} onChange={(event) => onChange(event.target.value)}>
          <option value="">{shown.length ? "Choose an app" : "No app matches"}</option>
          {shown.map((app) => (
            <option key={app.id} value={app.clientId} disabled={!app.registeredInGadget}>
              {app.label} ({app.clientId}){app.registeredInGadget ? "" : ": not in Gadget yet"}
            </option>
          ))}
        </select>
      </span>
    </span>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied.");
    } catch {
      setStatus("Copy failed: select the value and copy it by hand.");
    }
  };

  return (
    <span className="row wrap">
      <span className="small">{label}:</span>
      <code>{value}</code>
      <button type="button" className="button secondary" onClick={copy}>
        Copy<span className="visually-hidden"> {label}</span>
      </button>
      <span role="status" className="muted small">
        {status}
      </span>
    </span>
  );
}
