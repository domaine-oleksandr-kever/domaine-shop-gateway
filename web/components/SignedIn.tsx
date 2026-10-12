import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { errorText } from "../lib/api";
import { autoSignInAllowed, markAutoSignIn, startSignIn } from "../lib/auth";
import { useSession } from "../lib/session";
import type { Me } from "../lib/types";

/** Renders `children` for the signed-in user inside the page frame, or the sign-in screen. */
export function SignedIn({ children }: { children: (me: Me) => ReactNode }) {
  const { session, signOut } = useSession();
  if (session.status === "loading") return <p className="page muted">Loading…</p>;
  if (session.status === "signed-out") return <SignInScreen error={session.error} />;
  const { me } = session;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          Domaine Shop Gateway
        </a>
        <div className="user-line">
          <span>{me.email ?? me.sub}</span>
          {me.globalRole === "admin" && <span className="badge">global admin</span>}
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">{children(me)}</main>
    </>
  );
}

function SignInScreen({ error }: { error: string | null }) {
  const location = useLocation();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(() => !error && autoSignInAllowed());
  const autoStarted = useRef(false);

  const signIn = () => {
    setBusy(true);
    startSignIn(location.pathname + location.search).catch((reason) => {
      setFailure(errorText(reason));
      setBusy(false);
      setAuto(false);
    });
  };

  useEffect(() => {
    if (!auto || autoStarted.current) return;
    autoStarted.current = true;
    markAutoSignIn();
    signIn();
  }, [auto]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setAuto(false);
      setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (auto) {
    return (
      <main className="page narrow">
        <p className="muted" role="status">
          Signing you in…
        </p>
      </main>
    );
  }

  const message = failure ?? error;
  return (
    <main className="page narrow">
      <h1>Domaine Shop Gateway</h1>
      <p>Connect your Shopify stores to Claude Code and decide who may use them.</p>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <button type="button" className="button" onClick={signIn} disabled={busy}>
        Sign in with Google
      </button>
    </main>
  );
}
