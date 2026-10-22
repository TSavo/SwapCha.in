import type { Metadata } from "next";
import { PartnerDashboard } from "@/components/PartnerDashboard";

export const metadata: Metadata = {
  title: "Partner dashboard · SwapChan",
  robots: { index: false, follow: false },
};

export default async function PartnerDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PartnerDashboard id={id} />;
}
