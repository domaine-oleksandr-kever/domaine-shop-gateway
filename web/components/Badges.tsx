import type { StoreEnv } from "../lib/types";

export function EnvBadge({ env }: { env: StoreEnv }) {
  return <span className={`badge env-${env}`}>{env}</span>;
}

export function EnabledText({ enabled }: { enabled: boolean }) {
  return <span className={enabled ? "ok" : "muted"}>{enabled ? "Enabled" : "Disabled"}</span>;
}
