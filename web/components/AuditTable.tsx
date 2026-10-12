import type { AuditRow } from "../lib/types";
import { useGwData } from "../lib/useGwData";

export function AuditTable({ storeId }: { storeId: string }) {
  const { data, error } = useGwData<AuditRow[]>(`/gw/stores/${storeId}/audit?limit=50`);
  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="muted">Loading audit…</p>;
  if (data.length === 0) return <p className="muted">No activity yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">User</th>
            <th scope="col">Tool</th>
            <th scope="col">Operation</th>
            <th scope="col">Result</th>
            <th scope="col">Reason</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={`${row.createdAt}-${index}`}>
              <td>
                <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
              </td>
              <td>{row.userEmail ?? "system"}</td>
              <td>{row.tool}</td>
              <td>{[row.operationType, row.operationName].filter(Boolean).join(" ")}</td>
              <td className={row.allowed ? "ok" : "error-text"}>{row.allowed ? "allowed" : "refused"}</td>
              <td>{row.reason ?? ""}</td>
              <td>{row.durationMs == null ? "" : `${row.durationMs} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
