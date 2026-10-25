import { LegalPage } from "@/components/LegalPage";
import { TERMS } from "@/lib/legal";

export const metadata = {
  title: "Terms of Use · SwapChan",
  description: "SwapChan terms: non-custodial, you sign every transaction, 0.1% fee on swaps only.",
};

export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
