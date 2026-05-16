import type { Metadata } from "next";
import Link from "next/link";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(UserRole.REVIEWER);
  const links = [
    ["总览", "/admin"],
    ["单词", "/admin/words"],
    ["节点", "/admin/nodes"],
    ["词链", "/admin/chains"],
    ["审核", "/admin/reviews"],
    ["举报", "/admin/reports"],
    ["用户", "/admin/users"]
  ];
  return (
    <div className="border-t">
      <div className="container grid gap-6 py-6 lg:grid-cols-[180px_1fr]">
        <aside className="space-y-2">
          {links.map(([label, href]) => (
            <Link key={href} href={href} className="block rounded-md px-3 py-2 text-sm hover:bg-muted">
              {label}
            </Link>
          ))}
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
