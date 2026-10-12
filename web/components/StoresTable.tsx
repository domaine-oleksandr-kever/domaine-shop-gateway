import { Link } from "react-router";
import type { Store } from "../lib/types";
import { EnabledText, EnvBadge } from "./Badges";

export function StoresTable({ stores }: { stores: Store[] }) {
  if (stores.length === 0) return <p className="muted">No stores yet. Add one below, or ask a store-admin to add you.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Alias</th>
            <th scope="col">Domain</th>
            <th scope="col">Env</th>
            <th scope="col">Status</th>
            <th scope="col">Your role</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <tr key={store.id}>
              <td>
                <Link to={`/stores/${store.id}`}>{store.alias}</Link>
              </td>
              <td>{store.domain}</td>
              <td>
                <EnvBadge env={store.env} />
              </td>
              <td>
                <EnabledText enabled={store.enabled} />
              </td>
              <td>{store.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
