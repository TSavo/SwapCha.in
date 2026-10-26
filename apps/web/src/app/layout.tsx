import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ConnectButton } from "@/components/ConnectButton";
import { GaPageView } from "@/components/GaPageView";
import { Providers } from "@/components/Providers";
import { RefCapture } from "@/components/RefCapture";
import { DashboardPrompt } from "@/components/tools/DashboardPrompt";
import { GA_ID } from "@/lib/ga";
import { sanitizeGaUrl } from "@/lib/gaUrl";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://swapchan.com"),
  title: "SwapChan: best-price swaps, now with anime",
  description:
    "Swap-chan compares DEX aggregators and bridges to find your best same-chain or cross-chain route.",
  icons: { icon: "/characters/swapchan.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="sparkles antialiased">
        <Providers>
          <RefCapture />
          <AppShell connect={<ConnectButton />}>
            <main className="mx-auto flex max-w-5xl flex-col items-center px-4 pb-16">
              {children}
              <DashboardPrompt />
            </main>
            <footer className="site-chrome p-4 text-center text-xs text-violet-400 md:hidden">
              <Link href="/terms" className="hover:text-amber-300">
                Terms
              </Link>{" "}
              ·{" "}
              <Link href="/privacy" className="hover:text-amber-300">
                Privacy
              </Link>
            </footer>
          </AppShell>
        </Providers>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <GaPageView />
            <Script id="ga4" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());var __s=(${sanitizeGaUrl.toString()});var __r='';try{var __u=new URL(document.referrer);__r=__u.origin===location.origin?__s(document.referrer):__u.origin;}catch(e){}gtag('set',{page_location:__s(location.href),page_referrer:__r,page_title:'SwapChan '+__s(location.pathname)});gtag('config','${GA_ID}',{send_page_view:false});gtag('event','page_view');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
