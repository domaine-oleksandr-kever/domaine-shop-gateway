import { useId, useState, type FormEvent } from "react";
import { errorText, gwFetch } from "../lib/api";
import type { Member, PendingInvite, StoreRole } from "../lib/types";
import { useGwData } from "../lib/useGwData";

const ROLES: StoreRole[] = ["read", "dev", "store-admin"];

export function MembersSection({ storeId }: { storeId: string }) {
  const { data, error: loadError, reload } = useGwData<{ members: Member[]; invites: PendingInvite[] }>(
    `/gw/stores/${storeId}/members`
  );
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
        !loadError && <p className="muted">Loading members…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.userId}>
                  <td>{member.email ?? "—"}</td>
                  <td>{member.name ?? "—"}</td>
                  <td>{member.role}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={busy}
                      onClick={() => run(`/gw/stores/${storeId}/members/${member.userId}`, { method: "DELETE" })}
                    >
                      Remove<span className="visually-hidden"> {member.email ?? member.userId}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {data.invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td className="muted">invited, not signed in yet</td>
                  <td>{invite.role}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={busy}
                      onClick={() => run(`/gw/stores/${storeId}/invites/${invite.id}`, { method: "DELETE" })}
                    >
                      Revoke<span className="visually-hidden"> invite for {invite.email}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {data.members.length + data.invites.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <AddMemberForm busy={busy} onAdd={(email, role) => run(`/gw/stores/${storeId}/members`, { method: "POST", body: { email, role } })} />
    </>
  );
}

function AddMemberForm({ busy, onAdd }: { busy: boolean; onAdd: (email: string, role: StoreRole) => Promise<boolean> }) {
  const emailId = useId();
  const roleId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StoreRole>("read");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onAdd(email.trim(), role)) setEmail("");
  };

  return (
    <form className="row wrap add-member" onSubmit={submit} aria-label="Add member">
      <span className="field">
        <label htmlFor={emailId}>Email</label>
        <input id={emailId} type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
      </span>
      <span className="field">
        <label htmlFor={roleId}>Role</label>
        <select id={roleId} value={role} onChange={(event) => setRole(event.target.value as StoreRole)}>
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </span>
      <button type="submit" className="button" disabled={busy}>
        Add member
      </button>
    </form>
  );
}
