import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Smart Wallet — SwapChan",
  description:
    "Connect your wallet and say what you want to do. SwapChan's agent builds and verifies every transaction; you sign in your own wallet.",
};

export default function SmartWalletLayout({ children }: { children: React.ReactNode }) {
  return children;
}
