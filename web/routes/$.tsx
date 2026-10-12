import { data, Link } from "react-router";

export async function loader() {
  return data(null, 404);
}

export default function NotFound() {
  return (
    <main className="page narrow">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the gateway admin</Link>
      </p>
    </main>
  );
}
