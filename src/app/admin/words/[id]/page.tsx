import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { saveOfficialMnemonicAction } from "@/lib/services/mnemonic-service";
import { WordForm, DeleteWordForm } from "@/components/word-form";
import { MnemonicEditor } from "@/components/mnemonic-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

export default async function AdminWordEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const word = await prisma.word.findUnique({
    where: { id },
    include: {
      mnemonicEntries: { include: { author: true, reviewer: true, versions: { orderBy: { createdAt: "desc" } }, links: { include: { targetNode: true } } } },
      bookmarks: true,
      reviewCards: true
    }
  });
  if (!word) notFound();
  const official = word.mnemonicEntries.find((entry) => entry.sourceType === "OFFICIAL");
  const publicEntries = word.mnemonicEntries.filter((entry) => entry.sourceType === "USER_PUBLIC");
  return (
    <main className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">编辑 {word.word}</h1>
        <Link className="text-primary" href={`/word/${word.slug}`}>预览前台</Link>
      </div>
      <WordForm word={word} />
      <Card>
        <CardHeader><CardTitle>官方助记编辑器</CardTitle></CardHeader>
        <CardContent><MnemonicEditor action={saveOfficialMnemonicAction} targetWordId={word.id} mode="official" entry={official} /></CardContent>
      </Card>
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>公开用户助记</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {publicEntries.map((entry) => <div key={entry.id} className="rounded border p-3"><div className="flex justify-between"><span>{entry.title}</span><StatusBadge value={entry.status} /></div><p className="text-sm text-muted-foreground">{entry.author.displayName}</p></div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>链接与版本</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {official?.links.map((link) => <div key={link.id} className="rounded border p-2 text-sm">{link.targetNode.type}:{link.targetNode.displayName}</div>)}
            {official?.versions.map((version) => <div key={version.id} className="rounded border p-2 text-sm">版本：{version.title} · {version.createdAt.toLocaleString("zh-CN")}</div>)}
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader><CardTitle>危险操作</CardTitle></CardHeader>
        <CardContent><DeleteWordForm id={word.id} /></CardContent>
      </Card>
    </main>
  );
}
