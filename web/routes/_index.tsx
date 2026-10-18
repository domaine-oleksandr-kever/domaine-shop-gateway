import { useCallback } from "react";
import { AddStoreForm } from "../components/AddStoreForm";
import { DisabledStores } from "../components/DisabledStores";
import { PendingInstalls } from "../components/PendingInstalls";
import { SignedIn } from "../components/SignedIn";
import { StoresTable } from "../components/StoresTable";
import type { PendingInstallRow, ShopApp, Store } from "../lib/types";
import { useGwData } from "../lib/useGwData";

export default function Home() {
  return <SignedIn>{(me) => <Dashboard globalAdmin={me.globalRole === "admin"} />}</SignedIn>;
}

function Dashboard({ globalAdmin }: { globalAdmin: boolean }) {
  const { data: stores, error, reload } = useGwData<Store[]>("/gw/stores");
  const { data: installs, error: installsError, reload: reloadInstalls } = useGwData<PendingInstallRow[]>("/gw/installs");
  const apps = useGwData<ShopApp[]>(globalAdmin ? "/gw/apps" : null);
  // A finished install or a deleted store changes both the stores and the reservations.
  const onInstallChange = useCallback(() => {
    reloadInstalls();
    reload();
  }, [reloadInstalls, reload]);
  return (
    <>
      <section aria-labelledby="stores-heading">
        <h1 id="stores-heading">My stores</h1>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {stores ? <StoresTable stores={stores} globalAdmin={globalAdmin} onChange={onInstallChange} /> : !error && <p className="muted">Loading stores…</p>}
      </section>
      <section aria-labelledby="add-store-heading">
        <h2 id="add-store-heading">Add store</h2>
        <AddStoreForm globalAdmin={globalAdmin} apps={apps} onInstallChange={onInstallChange} />
      </section>
      {installsError && (
        <p className="error" role="alert">
          {installsError}
        </p>
      )}
      {installs && installs.length > 0 && (
        <section aria-labelledby="installs-heading">
          <h2 id="installs-heading">Unfinished installs</h2>
          <PendingInstalls rows={installs} onChange={onInstallChange} />
        </section>
      )}
      {globalAdmin && stores && (
        <section aria-labelledby="disabled-heading">
          <h2 id="disabled-heading">Pending and disabled stores</h2>
          <DisabledStores stores={stores} onChange={reload} />
        </section>
      )}
    </>
  );
}
