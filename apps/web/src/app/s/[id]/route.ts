import { NextResponse } from "next/server";
import { SERVER_API } from "@/lib/intel";

/** Permanent short links: swapchan.com/s/<id> → stored swapchan.com URL (302, counts the click). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = new URL("/", "https://swapchan.com");
  if (!/^[0-9A-Za-z]{1,16}$/.test(id)) return NextResponse.redirect(home, 302);
  try {
    const r = await fetch(`${SERVER_API}/links/${id}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as { url?: string };
    const dest = new URL(j.url ?? "");
    if (dest.protocol !== "https:" || !["swapchan.com", "www.swapchan.com"].includes(dest.hostname))
      throw new Error("bad");
    const ref = new URL(req.url).searchParams.get("ref");
    if (ref && !dest.searchParams.has("ref")) dest.searchParams.set("ref", ref);
    return NextResponse.redirect(dest, {
      status: 302,
      headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  } catch {
    return NextResponse.redirect(home, 302);
  }
}
