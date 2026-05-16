import Link from "next/link";
import { MemoryNodeType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mergeNodesAction, saveNodeAction } from "@/lib/services/word-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function AdminNodesPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const sp = await searchParams;
  const nodes = await prisma.memoryNode.findMany({
    where: {
      ...(sp.q ? { OR: [{ value: { contains: sp.q, mode: "insensitive" } }, { meaningCn: { contains: sp.q, mode: "insensitive" } }] } : {}),
      ...(sp.type ? { type: sp.type as MemoryNodeType } : {})
    },
    include: { incoming: true, outgoing: true, chainItems: true },
    orderBy: [{ type: "asc" }, { value: "asc" }],
    take: 100
  });
  return (
    <main>
      <h1 className="text-3xl font-semibold">节点管理</h1>
      <form className="mt-5 flex flex-wrap gap-3">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="搜索节点" className="max-w-sm" />
        <select name="type" defaultValue={sp.type ?? ""} className="h-10 rounded-md border bg-white px-3">
          <option value="">全部类型</option>
          {Object.values(MemoryNodeType).map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <Button>筛选</Button>
      </form>
      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">创建或编辑节点</h2>
        <form action={saveNodeAction} className="mt-3 grid gap-3 md:grid-cols-3">
          <select name="type" className="h-10 rounded-md border bg-white px-3">{Object.values(MemoryNodeType).map((type) => <option key={type}>{type}</option>)}</select>
          <Input name="value" placeholder="value" required />
          <Input name="displayName" placeholder="显示名称" />
          <Input name="meaningCn" placeholder="中文含义" />
          <Textarea name="description" placeholder="说明" className="md:col-span-2" />
          <Button>保存节点</Button>
        </form>
      </section>
      <div className="mt-6 overflow-hidden rounded-lg border bg-white">
        <Table>
          <thead><tr><Th>节点</Th><Th>类型</Th><Th>入链</Th><Th>出链</Th><Th>词链</Th><Th>页面</Th></tr></thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <Td>{node.displayName}</Td>
                <Td><Badge>{node.type}</Badge></Td>
                <Td>{node.incoming.length}</Td>
                <Td>{node.outgoing.length}</Td>
                <Td>{node.chainItems.length}</Td>
                <Td><Link className="text-primary" href={node.type === "WORD" ? `/word/${node.slug}` : `/node/${node.type.toLowerCase()}/${node.slug}`}>查看</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">合并重复节点</h2>
        <form action={mergeNodesAction} className="mt-3 flex flex-wrap gap-3">
          <Input name="fromId" placeholder="源节点 ID" className="max-w-xs" />
          <Input name="toId" placeholder="目标节点 ID" className="max-w-xs" />
          <Button variant="outline">合并</Button>
        </form>
      </section>
    </main>
  );
}
