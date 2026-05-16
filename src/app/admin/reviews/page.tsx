import Link from "next/link";
import { prisma } from "@/lib/db";
import { reviewSubmissionAction } from "@/lib/services/mnemonic-service";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { WikiRichText } from "@/components/wiki-rich-text";

export default async function AdminReviewsPage() {
  const pending = await prisma.mnemonicEntry.findMany({
    where: { status: "PENDING_REVIEW" },
    include: { targetWord: true, author: true },
    orderBy: { createdAt: "asc" }
  });
  return (
    <main>
      <h1 className="text-3xl font-semibold">公开助记审核</h1>
      <div className="mt-6 space-y-5">
        {pending.map((entry) => (
          <article key={entry.id} className="rounded-lg border bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{entry.title}</h2>
                <p className="text-sm text-muted-foreground">单词：<Link href={`/word/${entry.targetWord.slug}`}>{entry.targetWord.word}</Link> · 作者：{entry.author.displayName}</p>
              </div>
            </div>
            <div className="mt-4"><WikiRichText html={entry.contentHtml} /></div>
            <form action={reviewSubmissionAction} className="mt-5 grid gap-3 md:grid-cols-[1fr_140px_auto_auto_auto]">
              <input type="hidden" name="entryId" value={entry.id} />
              <Textarea name="reviewNote" placeholder="审核意见" />
              <Input name="editorScore" type="number" min={0} max={10} defaultValue={6} />
              <Button name="decision" value="approve">通过</Button>
              <Button name="decision" value="feature" variant="secondary">精选</Button>
              <Button name="decision" value="reject" variant="destructive">拒绝</Button>
            </form>
          </article>
        ))}
        {pending.length === 0 ? <p className="text-muted-foreground">暂无待审核内容。</p> : null}
      </div>
    </main>
  );
}
