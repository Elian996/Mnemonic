import { prisma } from "@/lib/db";
import { GraphView } from "@/components/graph-view";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function GraphPage() {
  const links = await prisma.memoryLink.findMany({
    include: { sourceNode: true, targetNode: true },
    take: 80,
    orderBy: { createdAt: "desc" }
  });
  const nodeMap = new Map<string, { id: string; label: string; type: string }>();
  links.forEach((link) => {
    nodeMap.set(link.sourceNode.id, { id: link.sourceNode.id, label: link.sourceNode.displayName, type: link.sourceNode.type });
    nodeMap.set(link.targetNode.id, { id: link.targetNode.id, label: link.targetNode.displayName, type: link.targetNode.type });
  });
  return (
    <InteriorPage>
      <InteriorContainer wide>
        <InteriorHero
          eyebrow="graph"
          title="记忆图谱"
          description="展示单词、词根、前缀、后缀、记忆块与词链之间的连接。"
          meta={`${nodeMap.size.toLocaleString("zh-CN")} 个节点 / ${links.length.toLocaleString("zh-CN")} 条连接`}
        />
      <div className="mt-8">
        <GraphView
          data={{
            nodes: [...nodeMap.values()],
            edges: links.map((link) => ({ id: link.id, source: link.sourceNodeId, target: link.targetNodeId, label: link.relationType }))
          }}
        />
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
