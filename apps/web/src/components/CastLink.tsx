"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Link to a cast page. `nested` renders a span with link behavior for spots that already sit
 * inside a <button> (route cards), where a real <a> would be invalid HTML.
 */
export function CastLink({
  href,
  label,
  nested = false,
  children,
}: {
  href: string;
  label: string;
  nested?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  if (!nested)
    return (
      <Link href={href} aria-label={label} title={label} className="cursor-pointer">
        {children}
      </Link>
    );
  const go = (e: { stopPropagation(): void; preventDefault(): void }) => {
    e.stopPropagation();
    e.preventDefault();
    router.push(href);
  };
  return (
    <span
      role="link"
      tabIndex={0}
      aria-label={label}
      title={label}
      className="cursor-pointer"
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") go(e);
      }}
    >
      {children}
    </span>
  );
}
