// Tiny inline trend chart (line + faint area) for stat cards. Pure SVG, scales
// to its container. Pass a short numeric series (e.g. 14 daily values).
export function Sparkline({
  data,
  className = "",
}: {
  data?: number[];
  className?: string;
}) {
  if (!data || data.length < 2) {
    return <div className={`h-6 ${className}`} />;
  }
  const max = Math.max(...data, 1);
  const W = 100;
  const H = 24;
  const step = W / (data.length - 1);
  const pts = data.map(
    (v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(2)}`,
  );
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`w-full h-6 text-primary ${className}`}
      aria-hidden
    >
      <path d={area} fill="currentColor" className="opacity-10" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="opacity-70"
      />
    </svg>
  );
}
