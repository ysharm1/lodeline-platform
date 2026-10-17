import Markup, { meta } from "../../_site/pages/privacy";
import { pageMetadata } from "../../_site/seo";

export const metadata = pageMetadata(meta, "/privacy");

export default function Page() {
  return <Markup />;
}
