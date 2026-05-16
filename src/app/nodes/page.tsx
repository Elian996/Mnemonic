import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function NodesPage() {
  const nodes = await prisma.memoryNode.findMany({ orderBy: [{ type: "asc" }, { value: "asc" }], take: 200 });
  return (
    <InteriorPage>
      <InteriorContainer wide>
      <InteriorHero
        eyebrow="nodes"
        title="记忆节点"
        description="词根、词缀、意象和单词在这里成为可复用的节点，帮助你把碎片接成结构。"
        meta={`展示最近 ${nodes.length.toLocaleString("zh-CN")} 个节点`}
      />
      <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => (
          <Link key={node.id} href={node.type === "WORD" ? `/word/${node.slug}` : `/node/${node.type.toLowerCase()}/${node.slug}`} className="mn-link-card p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{node.displayName}</span>
              <Badge>{node.type}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{node.meaningCn || node.description}</p>
          </Link>
        ))}
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
