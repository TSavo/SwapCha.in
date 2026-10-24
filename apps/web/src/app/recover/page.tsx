import type { Metadata } from "next";
import { Recover } from "@/components/tools/Recover";

export const metadata: Metadata = {
  title: "Recover your money, step by step | SwapChan",
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const ok = q.to?.match(/^0x[0-9a-fA-F]{40}$/) && q.data?.match(/^0x[0-9a-fA-F]*$/);
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 text-white">
      {ok ? (
        <Recover
          chain={Number(q.chain ?? 1)}
          to={q.to as `0x${string}`}
          data={q.data as `0x${string}`}
          value={q.value ?? "0"}
          title={q.title ?? "Recover funds"}
          next={q.next?.startsWith("https://swapchan.com/") || q.next?.startsWith("/") ? q.next : undefined}
        />
      ) : (
        <p>This recovery link is missing its transaction. Run find_money again for a fresh one.</p>
      )}
    </main>
  );
}
