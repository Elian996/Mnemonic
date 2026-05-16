import { prisma } from "@/lib/db";
import { moderateReportAction } from "@/lib/services/mnemonic-service";
import { suspendReportedUserAction } from "@/lib/services/word-service";
import { Button } from "@/components/ui/button";
import { WikiRichText } from "@/components/wiki-rich-text";
import { StatusBadge } from "@/components/status-badge";

export default async function AdminReportsPage() {
  const reports = await prisma.report.findMany({
    include: { reporter: true, mnemonicEntry: { include: { author: true, targetWord: true } } },
    orderBy: { createdAt: "desc" }
  });
  return (
    <main>
      <h1 className="text-3xl font-semibold">举报处理</h1>
      <div className="mt-6 space-y-5">
        {reports.map((report) => (
          <article key={report.id} className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{report.reason}</h2>
              <StatusBadge value={report.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">举报人：{report.reporter.displayName} · 被举报：{report.mnemonicEntry.author.displayName} · 单词：{report.mnemonicEntry.targetWord.word}</p>
            <p className="mt-3 text-sm">{report.detail}</p>
            <div className="mt-4"><WikiRichText html={report.mnemonicEntry.contentHtml} /></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <form action={moderateReportAction}><input type="hidden" name="reportId" value={report.id} /><Button name="decision" value="resolve">解决</Button></form>
              <form action={moderateReportAction}><input type="hidden" name="reportId" value={report.id} /><Button name="decision" value="hide" variant="destructive">隐藏内容</Button></form>
              <form action={moderateReportAction}><input type="hidden" name="reportId" value={report.id} /><Button name="decision" value="reject" variant="outline">驳回</Button></form>
              <form action={suspendReportedUserAction}><input type="hidden" name="userId" value={report.mnemonicEntry.authorId} /><Button variant="outline">暂停用户</Button></form>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
