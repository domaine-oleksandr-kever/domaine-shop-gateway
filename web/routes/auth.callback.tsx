import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { errorText } from "../lib/api";
import { finishSignIn } from "../lib/auth";
import { useSession } from "../lib/session";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { reload } = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // The authorization code is single-use; StrictMode's second effect run must not spend it again.
    if (started.current) return;
    started.current = true;
    finishSignIn(new URLSearchParams(window.location.search)).then(
      (returnTo) => {
        reload();
        navigate(returnTo, { replace: true });
      },
      (failure) => setError(errorText(failure))
    );
  }, [navigate, reload]);

  return (
    <main className="page narrow">
      {error ? (
        <>
          <h1>Sign-in failed</h1>
          <p className="error" role="alert">
            {error}
          </p>
          <Link to="/">Back to sign in</Link>
        </>
      ) : (
        <p className="muted" role="status">
          Signing you in…
        </p>
      )}
    </main>
  );
}
