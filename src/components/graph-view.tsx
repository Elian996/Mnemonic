"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, ReactFlow } from "@xyflow/react";

export type GraphData = {
  nodes: { id: string; label: string; type: string; href?: string }[];
  edges: { id: string; source: string; target: string; label?: string }[];
};

export function GraphView({ data }: { data: GraphData }) {
  const nodes = data.nodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 140 },
    data: { label: `${node.label}\n${node.type}` },
    style: {
      border: "1px solid #2b2924",
      borderRadius: 4,
      padding: 10,
      color: "#13110e",
      background: node.type === "WORD" ? "#fffaf0" : "#eadfce"
    }
  }));
  const edges = data.edges.map((edge) => ({ ...edge, animated: edge.label === "CHAIN" }));

  return (
    <div className="mn-panel h-[520px] overflow-hidden">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
