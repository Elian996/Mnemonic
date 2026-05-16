import { NextResponse } from "next/server";
import { UserRole, type User } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";

type ApiRoleGuardOptions = {
  hidden?: boolean;
  message?: string;
};

type ApiRoleGuardResult =
  | { user: User; response?: never }
  | { user?: never; response: NextResponse };

export async function requireApiRole(
  role: UserRole,
  options: ApiRoleGuardOptions = {}
): Promise<ApiRoleGuardResult> {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: options.hidden
        ? NextResponse.json({ error: "not found" }, { status: 404 })
        : NextResponse.json({ error: options.message || "请先登录。" }, { status: 401 })
    };
  }
  if (!hasRole(user, role)) {
    return {
      response: options.hidden
        ? NextResponse.json({ error: "not found" }, { status: 404 })
        : NextResponse.json({ error: options.message || "没有权限执行此操作。" }, { status: 403 })
    };
  }
  return { user };
}
