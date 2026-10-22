import Link from "next/link";
import { HowItWorks } from "@/components/HowItWorks";

export const metadata = { title: "How it works · SwapChan" };

export default function HowItWorksPage() {
  return (
    <>
      <h1 className="mt-4 mb-6 text-4xl font-black text-amber-300">How it works</h1>
      <HowItWorks />
      <Link
        href="/"
        className="mt-8 rounded-full bg-amber-400 px-6 py-3 font-black text-violet-950 hover:bg-amber-300"
      >
        Let&apos;s swap!
      </Link>
    </>
  );
}
