"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { authUrlWithNext, pathWithReturn, safeReturnPath } from "@/lib/return-path";

export function AccountNavLink({
  className,
  isAuthenticated
}: {
  className: string;
  isAuthenticated: boolean;
}) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentPath = safeReturnPath(`${pathname}${query ? `?${query}` : ""}`);
  const href = isAuthenticated
    ? pathWithReturn("/me", currentPath)
    : authUrlWithNext("/login", currentPath || "/me");
  const label = isAuthenticated ? "个人中心" : "登录";

  return (
    <Link href={href} aria-label={label} title={label} className={className}>
      <UserRound className="h-4 w-4" />
    </Link>
  );
}
