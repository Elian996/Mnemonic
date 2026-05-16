import Link from "next/link";
import { prisma } from "@/lib/db";
import { saveChainAction } from "@/lib/services/chain-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";

export default async function AdminChainsPage() {
  const [chains, nodes] = await Promise.all([
    prisma.memoryChain.findMany({ include: { items: { include: { node: true }, orderBy: { orderIndex: "asc" } } }, orderBy: { updatedAt: "desc" } }),
    prisma.memoryNode.findMany({ orderBy: [{ type: "asc" }, { value: "asc" }], take: 200 })
  ]);
  return (
    <main>
      <h1 className="text-3xl font-semibold">词链管理</h1>
      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">创建词链</h2>
        <form action={saveChainAction} className="mt-3 grid gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Input name="title" placeholder="标题" required />
            <Input name="slug" placeholder="slug" />
            <select name="status" className="h-10 rounded-md border bg-white px-3"><option value="DRAFT">草稿</option><option value="PUBLISHED">发布</option></select>
          </div>
          <Textarea name="description" placeholder="说明" />
          <Input name="nodeIds" placeholder="节点 ID，用英文逗号分隔，可从下方列表复制" />
          <Textarea name="notes" placeholder="每行对应一个节点备注" />
          <Button>保存词链</Button>
        </form>
      </section>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {chains.map((chain) => (
          <div key={chain.id} className="rounded-lg border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{chain.title}</h2>
              <StatusBadge value={chain.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{chain.items.map((item) => item.node.displayName).join(" → ")}</p>
            <Link className="mt-3 inline-block text-sm text-primary" href={`/chains/${chain.slug}`}>预览</Link>
          </div>
        ))}
      </section>
      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">节点池</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {nodes.map((node) => <div key={node.id} className="rounded border p-2 text-xs">{node.displayName} · {node.type}<br />{node.id}</div>)}
        </div>
      </section>
    </main>
  );
}
