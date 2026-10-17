import Markup, { meta } from "../../_site/pages/sample-evidence-pack";
import { pageMetadata } from "../../_site/seo";

export const metadata = pageMetadata(meta, "/sample-evidence-pack");

export default function Page() {
  return <Markup />;
}
