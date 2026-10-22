import type { Metadata } from "next";
import Link from "next/link";
import { PartnerSignup } from "@/components/PartnerSignup";

export const metadata: Metadata = {
  title: "SwapChan partners: earn 50% of swap fees from your widget",
  description:
    "Register your site, embed the SwapChan swap widget, and earn half of SwapChan's fee on every swap.",
  alternates: { canonical: "/partners" },
};

export default function PartnersPage() {
  return (
    <div className="w-full max-w-xl">
      <h1 className="mt-2 text-3xl font-black">Become a partner</h1>
      <p className="mt-2 text-violet-200">
        Embed the{" "}
        <Link href="/widget" className="text-amber-300 underline">
          SwapChan widget
        </Link>{" "}
        and earn <b>50% of our 0.1% fee</b> on every swap made through it. Users pay the same as on
        swapchan.com. Earnings accrue on a private dashboard and are paid out periodically in USDC.
      </p>
      <PartnerSignup />
    </div>
  );
}
