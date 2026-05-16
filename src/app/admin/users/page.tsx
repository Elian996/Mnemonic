import { prisma } from "@/lib/db";
import { updateUserAdminAction } from "@/lib/services/word-service";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    include: { mnemonicEntries: true, reviewLogs: true },
    orderBy: { createdAt: "desc" }
  });
  return (
    <main>
      <h1 className="text-3xl font-semibold">用户管理</h1>
      <div className="mt-6 overflow-hidden rounded-lg border bg-white">
        <Table>
          <thead><tr><Th>用户</Th><Th>角色</Th><Th>状态</Th><Th>贡献</Th><Th>复习</Th><Th>操作</Th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <Td><div className="font-medium">{user.displayName}</div><div className="text-xs text-muted-foreground">{user.email}</div></Td>
                <Td><StatusBadge value={user.role} /></Td>
                <Td><StatusBadge value={user.status} /></Td>
                <Td>{user.mnemonicEntries.length} 条 · {user.contributionScore} 分</Td>
                <Td>{user.reviewLogs.length}</Td>
                <Td>
                  <form action={updateUserAdminAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="userId" value={user.id} />
                    <select name="role" defaultValue={user.role} className="h-8 rounded border bg-white px-2 text-xs">
                      {["ADMIN", "EDITOR", "REVIEWER", "CONTRIBUTOR", "USER"].map((role) => <option key={role}>{role}</option>)}
                    </select>
                    <select name="status" defaultValue={user.status} className="h-8 rounded border bg-white px-2 text-xs">
                      <option>ACTIVE</option><option>SUSPENDED</option>
                    </select>
                    <Button size="sm">保存</Button>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </main>
  );
}
