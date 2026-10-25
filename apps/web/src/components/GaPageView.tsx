"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { GA_ID } from "@/lib/ga";
import { sanitizeGaUrl } from "@/lib/gaUrl";

type Gtag = (...a: unknown[]) => void;

/** Manual GA4 page_view with a sanitised URL/title on client route changes (config has send_page_view:false). */
export function GaPageView() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!GA_ID || typeof window === "undefined") return;
    const loc = sanitizeGaUrl(window.location.href);
    // First load: the inline script in layout.tsx already sent a sanitised page_view.
    if (prev.current === null) {
      prev.current = loc;
      return;
    }
    const g = (window as unknown as { gtag?: Gtag }).gtag;
    if (!g) return;
    const title = `SwapChan ${sanitizeGaUrl(window.location.pathname)}`;
    g("set", { page_location: loc, page_title: title, page_referrer: prev.current });
    g("event", "page_view", { page_location: loc, page_title: title });
    prev.current = loc;
  }, [pathname]);
  return null;
}
