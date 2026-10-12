import { Link, useParams } from "react-router";
import { AuditTable } from "../components/AuditTable";
import { EnabledText, EnvBadge } from "../components/Badges";
import { ConnectClaudeCode } from "../components/ConnectClaudeCode";
import { MembersSection } from "../components/MembersSection";
import { SignedIn } from "../components/SignedIn";
import { StoreSettings } from "../components/StoreSettings";
import type { Me, Store } from "../lib/types";
import { useGwData } from "../lib/useGwData";

export default function StoreRoute() {
  return <SignedIn>{(me) => <StorePage me={me} />}</SignedIn>;
}

function StorePage({ me }: { me: Me }) {
  const { id } = useParams();
  const { data: stores, error, reload } = useGwData<Store[]>("/gw/stores");
  const store = stores?.find((candidate) => candidate.id === id);

  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!stores) return <p className="muted">Loading store…</p>;
  if (!store) {
    return (
      <>
        <h1>Store not found</h1>
        <p>
          You have no role on this store. <Link to="/">Back to my stores</Link>
        </p>
      </>
    );
  }

  const storeAdmin = store.role === "store-admin";
  return (
    <>
      <p>
        <Link to="/">← My stores</Link>
      </p>
      <section aria-labelledby="store-heading">
        <h1 id="store-heading">{store.alias}</h1>
        <p className="row wrap">
          <span>{store.domain}</span>
          <EnvBadge env={store.env} />
          <EnabledText enabled={store.enabled} />
          <span className="muted">your role: {store.role}</span>
        </p>
        {storeAdmin && <StoreSettings key={store.alias} store={store} globalAdmin={me.globalRole === "admin"} onChange={reload} />}
      </section>
      <section aria-labelledby="connect-heading">
        <h2 id="connect-heading">Connect Claude Code</h2>
        <ConnectClaudeCode />
      </section>
      {storeAdmin && (
        <>
          <section aria-labelledby="members-heading">
            <h2 id="members-heading">Members</h2>
            <MembersSection storeId={store.id} />
          </section>
          <section aria-labelledby="audit-heading">
            <h2 id="audit-heading">Audit</h2>
            <AuditTable storeId={store.id} />
          </section>
        </>
      )}
    </>
  );
}
