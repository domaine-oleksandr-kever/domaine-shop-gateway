import { AddStoreForm } from "../components/AddStoreForm";
import { DisabledStores } from "../components/DisabledStores";
import { SignedIn } from "../components/SignedIn";
import { StoresTable } from "../components/StoresTable";
import type { Store } from "../lib/types";
import { useGwData } from "../lib/useGwData";

export default function Home() {
  return <SignedIn>{(me) => <Dashboard globalAdmin={me.globalRole === "admin"} />}</SignedIn>;
}

function Dashboard({ globalAdmin }: { globalAdmin: boolean }) {
  const { data: stores, error, reload } = useGwData<Store[]>("/gw/stores");
  return (
    <>
      <section aria-labelledby="stores-heading">
        <h1 id="stores-heading">My stores</h1>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {stores ? <StoresTable stores={stores} /> : !error && <p className="muted">Loading stores…</p>}
      </section>
      <section aria-labelledby="add-store-heading">
        <h2 id="add-store-heading">Add store</h2>
        <AddStoreForm />
      </section>
      {globalAdmin && stores && (
        <section aria-labelledby="disabled-heading">
          <h2 id="disabled-heading">Pending and disabled stores</h2>
          <DisabledStores stores={stores} onChange={reload} />
        </section>
      )}
    </>
  );
}
