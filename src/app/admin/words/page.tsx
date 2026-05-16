import Link from "next/link";
import { prisma } from "@/lib/db";
import { importWordsCsvAction } from "@/lib/services/word-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, Td, Th } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";

export default async function AdminWordsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; level?: string }> }) {
  const sp = await searchParams;
  const words = await prisma.word.findMany({
    where: {
      ...(sp.q ? { OR: [{ word: { contains: sp.q, mode: "insensitive" } }, { meaningCn: { contains: sp.q, mode: "insensitive" } }] } : {}),
      ...(sp.status ? { status: sp.status as never } : {}),
      ...(sp.level ? { levelTags: { has: sp.level as never } } : {})
    },
    include: { mnemonicEntries: { where: { sourceType: "OFFICIAL" } } },
    orderBy: { updatedAt: "desc" },
    take: 80
  });
  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">单词管理</h1>
        <Button asChild><Link href="/admin/words/new">创建单词</Link></Button>
      </div>
      <form className="mt-5 grid gap-3 md:grid-cols-[1fr_160px_160px_auto]">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="搜索单词或中文" />
        <select name="status" defaultValue={sp.status ?? ""} className="h-10 rounded-md border bg-white px-3"><option value="">全部状态</option><option value="PUBLISHED">已发布</option><option value="EMPTY">空白</option><option value="DRAFT">草稿</option></select>
        <select name="level" defaultValue={sp.level ?? ""} className="h-10 rounded-md border bg-white px-3"><option value="">全部等级</option><option value="CET4">四级</option><option value="CET6">六级</option><option value="HIGH_SCHOOL">高中</option></select>
        <Button>筛选</Button>
      </form>
      <div className="mt-6 overflow-hidden rounded-lg border bg-white">
        <Table>
          <thead><tr><Th>单词</Th><Th>释义</Th><Th>状态</Th><Th>官方助记</Th><Th>操作</Th></tr></thead>
          <tbody>
            {words.map((word) => (
              <tr key={word.id}>
                <Td className="font-medium">{word.word}</Td>
                <Td>{word.shortMeaningCn}</Td>
                <Td><StatusBadge value={word.status} /></Td>
                <Td>{word.mnemonicEntries.length}</Td>
                <Td><Link className="text-primary" href={`/admin/words/${word.id}`}>编辑</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <section className="mt-8 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">CSV 导入</h2>
        <form action={importWordsCsvAction} className="mt-3 space-y-3">
          <Textarea name="csv" placeholder="word,phoneticUk,phoneticUs,partOfSpeech,meaningCn,meaningEn,shortMeaningCn,levelTags,frequencyRank,difficulty" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dryRun" /> 仅试运行</label>
          <Button>导入</Button>
        </form>
      </section>
    </main>
  );
}
