const nodes = [
  { label: "legitimate", x: 122, y: 28, width: 116, height: 38 },
  { label: "legal", x: 34, y: 102, width: 82, height: 38 },
  { label: "-acy", x: 254, y: 102, width: 70, height: 38 },
  { label: "rightful", x: 36, y: 226, width: 96, height: 38 },
  { label: "authority", x: 224, y: 226, width: 102, height: 38 }
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
      <title id="mini-word-graph-title">legitimacy word chain</title>
      <circle className="mn-mini-graph-ring mn-mini-graph-ring-inner" cx="180" cy="150" r="70" />
      <circle className="mn-mini-graph-ring" cx="180" cy="150" r="102" />
      <circle className="mn-mini-graph-ring mn-mini-graph-ring-outer" cx="180" cy="150" r="132" />

      {links.map((link) => (
        <line key={`${link.x1}-${link.y1}`} className="mn-mini-graph-link" {...link} />
      ))}

      <circle className="mn-mini-graph-center" cx="180" cy="150" r="56" />
      <text className="mn-mini-graph-center-text" x="180" y="150" textAnchor="middle" dominantBaseline="middle">
        legitimacy
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
