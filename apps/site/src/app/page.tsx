import { SiteShell } from "../components/site-shell";
import { loadRepoFacts } from "../lib/repo-facts";

export default async function Page() {
  const facts = await loadRepoFacts();
  return <SiteShell facts={facts} />;
}
