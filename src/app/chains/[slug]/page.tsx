import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { GraphView } from "@/components/graph-view";
import { Badge } from "@/components/ui/badge";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const chain = await prisma.memoryChain.findUnique({ where: { slug } });
  return chain ? { title: `${chain.title} | mnemonic`, description: chain.description ?? "记忆词链" } : {};
}

export default async function ChainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chain = await prisma.memoryChain.findUnique({
    where: { slug },
    include: { items: { include: { node: true }, orderBy: { orderIndex: "asc" } } }
  });
  if (!chain || chain.status !== "PUBLISHED") notFound();
  const graphData = {
    nodes: chain.items.map((item) => ({ id: item.node.id, label: item.node.displayName, type: item.node.type })),
    edges: chain.items.slice(1).map((item, index) => ({
      id: `${chain.items[index].nodeId}-${item.nodeId}`,
      source: chain.items[index].nodeId,
      target: item.nodeId,
      label: "CHAIN"
    }))
  };
  return (
    <InteriorPage>
      <InteriorContainer wide>
      <InteriorHero
        eyebrow="chain"
        title={chain.title}
        description={chain.description}
        meta={`${chain.items.length.toLocaleString("zh-CN")} 个节点`}
      />
      <div className="mt-8 flex flex-wrap items-center gap-2 text-xl">
        {chain.items.map((item, index) => (
          <span key={item.id} className="flex items-center gap-2">
            <Link href={item.node.type === "WORD" ? `/word/${item.node.slug}` : `/node/${item.node.type.toLowerCase()}/${item.node.slug}`}>
              <Badge className="text-base">{item.node.displayName}</Badge>
            </Link>
            {index < chain.items.length - 1 ? <span>→</span> : null}
          </span>
        ))}
      </div>
      <div className="mt-8 grid gap-4">
        {chain.items.map((item) => (
          <InteriorPanel key={item.id} className="p-4">
            <div className="font-semibold">{item.node.displayName}</div>
            <p className="mt-1 text-sm text-muted-foreground">{item.note || item.node.meaningCn}</p>
          </InteriorPanel>
        ))}
      </div>
      <section className="mt-8"><GraphView data={graphData} /></section>
      </InteriorContainer>
    </InteriorPage>
  );
}
