import type { MetadataRoute } from "next";
import { castOrder } from "@/lib/bios";
import { ROUTES, routeHref } from "@/lib/routes";

const SITE = "https://swapchan.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (p: string, priority: number) => ({
    url: `${SITE}${p}`,
    lastModified: now,
    priority,
  });
  return [
    page("/", 1),
    page("/swap", 0.9),
    page("/bridge", 0.9),
    page("/agents", 0.8),
    page("/how-it-works", 0.6),
    page("/widget", 0.6),
    page("/partners", 0.5),
    page("/earn", 0.7),
    page("/cast", 0.6),
    ...castOrder.map((k) => page(`/cast/${k}`, 0.5)),
    ...ROUTES.map((r) => page(routeHref(r), 0.7)),
  ];
}
