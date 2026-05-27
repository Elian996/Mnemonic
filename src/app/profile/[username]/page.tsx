import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      mnemonicEntries: { where: { isPublic: true }, include: { targetWord: true }, take: 20 },
      wordMarks: { where: { state: "UNKNOWN" }, include: { word: true }, take: 20 },
      reviewLogs: true
    }
  });
  if (!user) notFound();
  const likes = await prisma.mnemonicEntry.aggregate({ where: { authorId: user.id }, _sum: { likeCount: true } });
  return (
    <InteriorPage>
      <InteriorContainer>
        <InteriorHero
          eyebrow={`@${user.username}`}
          title={user.displayName}
          description={`单词卡贡献：${user.wordCardContributionCount} · 贡献分：${user.contributionScore} · 获赞：${likes._sum.likeCount ?? 0} · 复习次数：${user.reviewLogs.length}`}
          meta="公开主页"
        />
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="mn-panel">
          <CardHeader><CardTitle className="font-serif text-2xl">公开贡献</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {user.mnemonicEntries.map((entry) => (
              <Link key={entry.id} href={`/word/${entry.targetWord.slug}`} className="mn-link-card p-3">
                {entry.targetWord.word} · {entry.title}
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="mn-panel">
          <CardHeader><CardTitle className="font-serif text-2xl">生词本</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {user.wordMarks.map((mark) => (
              <Link key={mark.id} href={`/word/${mark.word.slug}`} className="mn-link-card p-3">
                {mark.word.word} · {mark.word.shortMeaningCn}
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
      </InteriorContainer>
    </InteriorPage>
  );
}
