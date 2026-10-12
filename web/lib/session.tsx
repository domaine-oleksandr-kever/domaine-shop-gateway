import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, errorText, gwFetch, SIGNED_OUT_EVENT } from "./api";
import { accessToken, signOut as dropTokens } from "./auth";
import type { Me } from "./types";

export type Session =
  | { status: "loading" }
  | { status: "signed-out"; error: string | null }
  | { status: "signed-in"; me: Me };

interface SessionValue {
  session: Session;
  reload: () => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Resolves who is signed in once per page load; renders nothing user-specific until the browser has the tokens. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  const reload = useCallback(() => {
    if (!accessToken()) {
      setSession({ status: "signed-out", error: null });
      return;
    }
    setSession({ status: "loading" });
    gwFetch<Me>("/gw/me").then(
      (me) => setSession({ status: "signed-in", me }),
      (error) => setSession({ status: "signed-out", error: error instanceof ApiError && error.status === 401 ? null : errorText(error) })
    );
  }, []);

  const signOut = useCallback(() => {
    dropTokens();
    setSession({ status: "signed-out", error: null });
  }, []);

  useEffect(() => {
    reload();
    const onSignedOut = () => setSession({ status: "signed-out", error: null });
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [reload]);

  return <SessionContext.Provider value={{ session, reload, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
