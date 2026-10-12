import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { ProductionErrorBoundary, DevelopmentErrorBoundary } from "gadget-server/react-router";
import "./app.css";
import { SessionProvider } from "./lib/session";
import type { Route } from "./+types/root";

export const links = () => [{ rel: "stylesheet", href: "https://assets.gadget.dev/assets/reset.min.css" }];

export const meta = () => [
  { charset: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { title: "Domaine Shop Gateway" },
];

/** Shopify opens the app URL inside its admin (with `host`) after an install; sign-in cannot run in that frame, so it only links out. */
export const loader = ({ request }: Route.LoaderArgs) => ({
  embedded: new URL(request.url).searchParams.has("host"),
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  if (loaderData.embedded) return <EmbeddedNotice />;
  return (
    <SessionProvider>
      <Outlet />
    </SessionProvider>
  );
}

function EmbeddedNotice() {
  return (
    <main className="page narrow">
      <h1>Domaine Shop Gateway is installed</h1>
      <p>Manage stores, members and the Claude Code connection on the gateway admin page.</p>
      <p>
        <a className="button" href="/" target="_blank" rel="noopener">
          Open the gateway admin
        </a>
      </p>
    </main>
  );
}

export function HydrateFallback() {
  return <p className="page muted">Loading…</p>;
}

export const ErrorBoundary = process.env.NODE_ENV === "production" ? ProductionErrorBoundary : DevelopmentErrorBoundary;
