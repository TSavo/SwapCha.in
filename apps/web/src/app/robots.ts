import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://swapchan.com/sitemap.xml",
    host: "https://swapchan.com",
  };
}
