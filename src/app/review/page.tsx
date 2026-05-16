import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { completeReviewAction } from "@/lib/services/mnemonic-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WikiRichText } from "@/components/wiki-rich-text";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function ReviewPage() {
  const user = await requireUser();
  const cards = await prisma.reviewCard.findMany({
    where: { userId: user.id, dueAt: { lte: new Date() }, state: { not: "SUSPENDED" } },
    include: { word: true, mnemonicEntry: true },
    orderBy: { dueAt: "asc" },
    take: 20
  });
  return (
    <InteriorPage>
      <InteriorContainer>
        <InteriorHero
          eyebrow="review"
          title="今日复习"
          description="把到期卡片逐张翻出来，判断熟悉程度，让复习节奏继续向前。"
          meta={`${cards.length.toLocaleString("zh-CN")} 张到期卡片`}
        />
      <div className="mt-8 space-y-5">
        {cards.map((card) => (
          <Card key={card.id} className="mn-panel">
            <CardHeader><CardTitle className="font-serif text-3xl">{card.word.word}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-lg">{card.word.meaningCn}</p>
              {card.mnemonicEntry ? <div className="mt-4"><WikiRichText html={card.mnemonicEntry.contentHtml} /></div> : null}
              <form action={completeReviewAction} className="mt-5 flex flex-wrap gap-2">
                <input type="hidden" name="cardId" value={card.id} />
                <Button name="rating" value="AGAIN" variant="destructive">不认识</Button>
                <Button name="rating" value="HARD" variant="outline">模糊</Button>
                <Button name="rating" value="GOOD">认识</Button>
                <Button name="rating" value="EASY" variant="secondary">很熟</Button>
              </form>
            </CardContent>
          </Card>
        ))}
        {cards.length === 0 ? <p className="text-muted-foreground">今天没有到期卡片，可以去单词页加入复习。</p> : null}
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
