import { Dashboard } from "../components/dashboard";

/** The seed is fixed so the server render and the client render agree exactly (no hydration mismatch). */
export default function Page() {
  return <Dashboard initialSeed={42} />;
}
