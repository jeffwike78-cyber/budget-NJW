// Simple two-series SVG bar chart, no external charting library.
// data: [{ label, a, b }], a/b are non-negative numbers.
export default function BarChart({ data, aLabel, bLabel, height = 220 }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const barWidth = 10;
  const groupGap = 26;
  const pairGap = 4;

  return (
    <div className="bar-chart">
      <div className="bar-chart-legend">
        <span className="legend-item">
          <span className="legend-dot legend-dot-a" /> {aLabel}
        </span>
        <span className="legend-item">
          <span className="legend-dot legend-dot-b" /> {bLabel}
        </span>
      </div>
      <svg
        className="bar-chart-svg"
        viewBox={`0 0 ${data.length * (barWidth * 2 + pairGap + groupGap)} ${height}`}
        preserveAspectRatio="xMidYMax meet"
      >
        {data.map((d, i) => {
          const groupX = i * (barWidth * 2 + pairGap + groupGap) + groupGap / 2;
          const chartBottom = height - 24;
          const chartTop = 8;
          const usable = chartBottom - chartTop;
          const aH = (d.a / max) * usable;
          const bH = (d.b / max) * usable;
          return (
            <g key={d.label}>
              <rect
                x={groupX}
                y={chartBottom - aH}
                width={barWidth}
                height={Math.max(aH, 1)}
                rx="3"
                className="bar-a"
              />
              <rect
                x={groupX + barWidth + pairGap}
                y={chartBottom - bH}
                width={barWidth}
                height={Math.max(bH, 1)}
                rx="3"
                className="bar-b"
              />
              <text x={groupX + barWidth} y={height - 6} textAnchor="middle" className="bar-chart-label">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
