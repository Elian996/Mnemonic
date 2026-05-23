const nodes = [
  { label: "remember", x: 142, y: 28, width: 96, height: 38 },
  { label: "remind", x: 32, y: 102, width: 92, height: 38 },
  { label: "recall", x: 248, y: 102, width: 82, height: 38 },
  { label: "memorise", x: 36, y: 226, width: 108, height: 38 },
  { label: "recollection", x: 218, y: 226, width: 118, height: 38 }
];

const links = [
  { x1: 180, y1: 94, x2: 190, y2: 66 },
  { x1: 130, y1: 128, x2: 124, y2: 121 },
  { x1: 230, y1: 128, x2: 248, y2: 121 },
  { x1: 138, y1: 184, x2: 144, y2: 245 },
  { x1: 222, y1: 184, x2: 218, y2: 245 }
];

export function MiniWordGraph() {
  return (
    <svg className="mn-mini-word-graph" viewBox="0 0 360 300" role="img" aria-labelledby="mini-word-graph-title">
      <title id="mini-word-graph-title">memory word chain</title>
      <circle className="mn-mini-graph-ring mn-mini-graph-ring-inner" cx="180" cy="150" r="70" />
      <circle className="mn-mini-graph-ring" cx="180" cy="150" r="102" />
      <circle className="mn-mini-graph-ring mn-mini-graph-ring-outer" cx="180" cy="150" r="132" />

      {links.map((link) => (
        <line key={`${link.x1}-${link.y1}`} className="mn-mini-graph-link" {...link} />
      ))}

      <circle className="mn-mini-graph-center" cx="180" cy="150" r="56" />
      <text className="mn-mini-graph-center-text" x="180" y="150" textAnchor="middle" dominantBaseline="middle">
        memory
      </text>

      {nodes.map((node) => (
        <g key={node.label} className="mn-mini-graph-node">
          <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="19" />
          <text x={node.x + node.width / 2} y={node.y + node.height / 2} textAnchor="middle" dominantBaseline="middle">
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
