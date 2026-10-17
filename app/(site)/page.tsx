import Markup, { meta } from "../_site/pages/home";
import { pageMetadata, siteUrl } from "../_site/seo";

export const metadata = pageMetadata(meta, "/");

export default function Page() {
  const url = siteUrl() + "/";
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "Lodeline", url },
      { "@type": "Organization", name: "Lodeline", url, email: "info@lodeline.org", telephone: "+1-602-315-9861", logo: `${siteUrl()}/assets/mark.svg` },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <Markup />
    </>
  );
}
