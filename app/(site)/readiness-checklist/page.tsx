import Markup, { meta } from "../../_site/pages/readiness-checklist";
import { pageMetadata } from "../../_site/seo";

export const metadata = pageMetadata(meta, "/readiness-checklist");

export default function Page() {
  return <Markup />;
}
