import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function ChainsPage() {
  const chains = await prisma.memoryChain.findMany({
    where: { status: "PUBLISHED" },
    include: { items: { include: { node: true }, orderBy: { orderIndex: "asc" } } },
    orderBy: { updatedAt: "desc" }
  });
  return (
    <InteriorPage>
      <InteriorContainer>
        <InteriorHero
          eyebrow="chains"
          title="词链"
          description="把词根、派生词和相邻意象连成一条可追踪的路径，让记忆从孤立卡片变成路线。"
          meta={`${chains.length.toLocaleString("zh-CN")} 条已发布词链`}
        />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {chains.map((chain) => (
          <Card key={chain.id} className="mn-link-card">
            <CardHeader><CardTitle className="font-serif text-2xl"><Link href={`/chains/${chain.slug}`}>{chain.title}</Link></CardTitle></CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{chain.description}</p>
              <p className="mt-3 text-sm">{chain.items.map((item) => item.node.displayName).join(" → ")}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
