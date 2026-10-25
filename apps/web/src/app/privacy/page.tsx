import { LegalPage } from "@/components/LegalPage";
import { PRIVACY } from "@/lib/legal";

export const metadata = {
  title: "Privacy Policy · SwapChan",
  description:
    "What SwapChan collects: no accounts, public addresses for lookups, sanitised analytics.",
};

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
