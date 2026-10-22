import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { chainKey, routeBySlug, title } from "@/lib/routes";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400;

const png = async (key: string) => {
  for (const base of [
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "apps/web/public"),
  ]) {
    try {
      return `data:image/png;base64,${(await readFile(path.join(base, "characters", `${key}.png`))).toString("base64")}`;
    } catch {}
  }
  return null;
};

export default async function OG({ params }: { params: Promise<{ route: string }> }) {
  const r = routeBySlug((await params).route);
  const t = r ? title(r) : "SwapChan: best-price swaps";
  const keys = r ? [...new Set([chainKey(r.fromChainId), chainKey(r.toChainId)])] : ["swapchan"];
  const imgs = (await Promise.all(["swapchan", ...keys].map(png))).filter(Boolean) as string[];
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg,#2e1065,#701a75)",
        color: "white",
        padding: 48,
      }}
    >
      <div style={{ display: "flex", gap: 24 }}>
        {imgs.map((src) => (
          <img key={src.slice(-32)} src={src} width={220} height={220} alt="" />
        ))}
      </div>
      <div style={{ fontSize: 56, fontWeight: 900, textAlign: "center", marginTop: 24 }}>{t}</div>
      <div style={{ fontSize: 30, color: "#fcd34d", marginTop: 12 }}>
        swapchan.com · live quotes from every aggregator
      </div>
    </div>,
    size,
  );
}
