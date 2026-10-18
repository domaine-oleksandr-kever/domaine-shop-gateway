import { useEffect, useState } from "react";
import { errorText, gwFetch } from "../lib/api";
import type { PendingInstallRow } from "../lib/types";

const REFRESH_MS = 30_000;

/** Installs started from the form that have not reached the gateway yet, and those that never will. */
export function PendingInstalls({ rows, onChange }: { rows: PendingInstallRow[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busyShop, setBusyShop] = useState<string | null>(null);
  const waiting = rows.some((row) => !row.expired);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(onChange, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [waiting, onChange]);

  const dismiss = async (shop: string) => {
    setBusyShop(shop);
    setError(null);
    try {
      await gwFetch(`/gw/installs/${encodeURIComponent(shop)}`, { method: "DELETE" });
    } catch (failure) {
      setError(errorText(failure));
    }
    onChange();
    setBusyShop(null);
  };

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="plain-list">
        {rows.map((row) => (
          <li key={row.shop} className="row spread">
            {row.expired ? (
              <p className="error">
                <strong>{row.shop}</strong>
                {row.userEmail !== undefined && <span className="small"> ({who(row)})</span>}: Install
                did not reach the gateway. Possible causes: the Gadget plan's install limit, or Shopify refused (a store
                that is not a development store needs its own app).{row.userEmail === undefined && " Contact a global admin."}
              </p>
            ) : (
              <p>
                <strong>{row.shop}</strong>
                {row.userEmail !== undefined && <span className="muted small"> ({who(row)})</span>}:
                waiting for Shopify, {minutesLeft(row.expiresAt)} min left
              </p>
            )}
            {row.expired && (
              <button
                type="button"
                className="button secondary"
                disabled={busyShop === row.shop}
                aria-label={`Dismiss ${row.shop}`}
                onClick={() => dismiss(row.shop)}
              >
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function who(row: PendingInstallRow): string {
  const email = row.userEmail ?? "unknown user";
  return row.clientId ? `${email}, app ${row.clientId}` : email;
}

function minutesLeft(expiresAt: string): number {
  return Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000));
}
