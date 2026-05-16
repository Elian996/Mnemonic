import Link from "next/link";
import { notFound } from "next/navigation";
import { MemoryNodeType, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GraphView } from "@/components/graph-view";
import { Button } from "@/components/ui/button";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function NodePage({ params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  const user = await getCurrentUser();
  const node = await prisma.memoryNode.findUnique({
    where: { type_slug: { type: type.toUpperCase() as MemoryNodeType, slug } },
    include: {
      incoming: { include: { sourceNode: true, sourceMnemonicEntry: { include: { targetWord: true } } } },
      outgoing: { include: { targetNode: true } },
      chainItems: { include: { chain: true } }
    }
  });
  if (!node) notFound();
  const graphData = {
    nodes: [
      { id: node.id, label: node.displayName, type: node.type },
      ...node.incoming.map((link) => ({ id: link.sourceNode.id, label: link.sourceNode.displayName, type: link.sourceNode.type })),
      ...node.outgoing.map((link) => ({ id: link.targetNode.id, label: link.targetNode.displayName, type: link.targetNode.type }))
    ],
    edges: [
      ...node.incoming.map((link) => ({ id: link.id, source: link.sourceNodeId, target: link.targetNodeId, label: link.relationType })),
      ...node.outgoing.map((link) => ({ id: link.id, source: link.sourceNodeId, target: link.targetNodeId, label: link.relationType }))
    ]
  };

  return (
    <InteriorPage>
      <InteriorContainer wide>
      <InteriorHero
        eyebrow={node.type}
        title={node.displayName}
        description={node.meaningCn || node.description}
        meta={`${node.incoming.length.toLocaleString("zh-CN")} 个引用 / ${node.chainItems.length.toLocaleString("zh-CN")} 条词链`}
        actions={hasRole(user, UserRole.EDITOR) ? <Button asChild variant="outline"><Link href="/admin/nodes">编辑节点</Link></Button> : null}
      />
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="mn-panel">
          <CardHeader><CardTitle className="font-serif text-2xl">相关单词与引用</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {node.incoming.map((link) => (
              <div key={link.id} className="rounded-md border p-3">
                {link.sourceMnemonicEntry ? (
                  <Link href={`/word/${link.sourceMnemonicEntry.targetWord.slug}`}>
                    {link.sourceMnemonicEntry.targetWord.word} 的助记引用了 {node.displayName}
                  </Link>
                ) : (
                  <span>{link.sourceNode.displayName}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="mn-panel">
          <CardHeader><CardTitle className="font-serif text-2xl">所在词链</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {node.chainItems.map((item) => (
              <Link key={item.id} href={`/chains/${item.chain.slug}`} className="mn-link-card p-3">
                {item.chain.title}
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
      <section className="mt-8">
        <GraphView data={graphData} />
      </section>
      </InteriorContainer>
    </InteriorPage>
  );
}
