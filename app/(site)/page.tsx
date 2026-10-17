import Markup, { meta } from "../_site/pages/home";
import { pageMetadata, siteUrl } from "../_site/seo";

export const metadata = pageMetadata(meta, "/");

export default function Page() {
  const url = siteUrl() + "/";
  // Same JSON-LD as the live site (origin follows APP_BASE_URL).
  const ld = { "@context": "https://schema.org", "@type": "WebSite", name: "Lodeline", url };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <Markup />
    </>
  );
}
