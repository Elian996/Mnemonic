import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminDashboard() {
  const [totalWords, officialCount, pending, reports, recent, byStatus, byLevel] = await Promise.all([
    prisma.word.count(),
    prisma.mnemonicEntry.count({ where: { sourceType: "OFFICIAL" } }),
    prisma.mnemonicEntry.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.report.count({ where: { status: "OPEN" } }),
    prisma.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.word.groupBy({ by: ["status"], _count: true }),
    prisma.word.findMany({ select: { levelTags: true, status: true } })
  ]);
  const needs = await prisma.word.findMany({ where: { status: { in: ["EMPTY", "NEEDS_REVISION"] } }, take: 10 });

  return (
    <main>
      <h1 className="text-3xl font-semibold">管理后台</h1>
      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <Metric title="单词总数" value={totalWords} />
        <Metric title="官方助记" value={officialCount} />
        <Metric title="待审核" value={pending} />
        <Metric title="未处理举报" value={reports} />
      </section>
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>状态分布</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {byStatus.map((item) => <div key={item.status} className="flex justify-between"><span>{item.status}</span><span>{item._count}</span></div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>需要助记的单词</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {needs.map((word) => <Link key={word.id} href={`/admin/words/${word.id}`} className="block rounded border p-2">{word.word} · {word.shortMeaningCn}</Link>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>最近编辑</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recent.map((log) => <div key={log.id} className="rounded border p-2 text-sm">{log.actor.displayName} · {log.action} · {log.entityType}</div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>等级完成度</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {["PRIMARY", "MIDDLE_SCHOOL", "HIGH_SCHOOL", "CET4", "CET6"].map((level) => {
              const all = byLevel.filter((word) => word.levelTags.includes(level as never)).length;
              const done = byLevel.filter((word) => word.levelTags.includes(level as never) && word.status === "PUBLISHED").length;
              return <div key={level} className="flex justify-between"><span>{level}</span><span>{done}/{all}</span></div>;
            })}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent><div className="text-3xl font-semibold">{value}</div></CardContent>
    </Card>
  );
}
