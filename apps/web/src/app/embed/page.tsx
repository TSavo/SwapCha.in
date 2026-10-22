import type { Metadata } from "next";
import { EmbedWidget } from "@/components/EmbedWidget";

export const metadata: Metadata = {
  title: "SwapChan swap widget",
  robots: { index: false, follow: false },
};

/** The iframe target for widget.js and plain-iframe embeds. Covers the site chrome. */
export default function EmbedPage() {
  return <EmbedWidget />;
}
