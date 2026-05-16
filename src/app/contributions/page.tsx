import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function ContributionsPage() {
  const user = await requireUser();
  const entries = await prisma.mnemonicEntry.findMany({
    where: { authorId: user.id },
    include: { targetWord: true },
    orderBy: { updatedAt: "desc" }
  });
  return (
    <InteriorPage>
      <InteriorContainer>
        <InteriorHero
          eyebrow="contributions"
          title="我的贡献"
          description="你公开提交或参与维护的记忆卡片，会在这里形成一张个人贡献清单。"
          meta={`${entries.length.toLocaleString("zh-CN")} 条记录`}
        />
      <div className="mt-8 space-y-3">
        {entries.map((entry) => (
          <Link key={entry.id} href={`/word/${entry.targetWord.slug}`} className="mn-link-card flex items-center justify-between p-4">
            <span>{entry.targetWord.word} · {entry.title}</span>
            <StatusBadge value={entry.status} />
          </Link>
        ))}
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
