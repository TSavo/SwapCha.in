"use client";

import { useEffect } from "react";
import { captureRef } from "@/lib/embed";

/** Stores ?ref=<partnerId> from affiliate links (30 days, last click wins). */
export function RefCapture() {
  useEffect(() => {
    if (!window.location.pathname.startsWith("/embed")) captureRef();
  }, []);
  return null;
}
