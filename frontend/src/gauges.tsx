import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { gsap } from "gsap";
import type { ComponentView, StrategyKind } from "./contractService";

// ─── Strategy palette ────────────────────────────────────────────────────────
export const KIND_COLOR: Record<StrategyKind, string> = {
  LENDING: "#4ADE80",
  LP_FEES: "#FFB84D",
  STAKING: "#2DD4BF",
  AIRDROP: "#A78BFA",
  REBATE: "#F0ABFC",
  PARENT_VAULT: "#60A5FA",
  EXTERNAL: "#94A3B8",
};

export interface SunburstSeg {
  kind: StrategyKind;
  protocol: string;
  contributionBps: number;
  plausibilityPct: number;
  componentId: number;
}

// ─── D3 SUNBURST: strategy components, arc ∝ bps, center = claimed APY ────────
export function Sunburst({
  components,
  claimedApyBps,
  size = 360,
  onHover,
}: {
  components: ComponentView[];
  claimedApyBps: number;
  size?: number;
  onHover?: (seg: SunburstSeg | null) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = size, H = size;
    const cx = W / 2, cy = H / 2;
    const inner = W * 0.26;
    const outerMin = W * 0.30;
    const outerMax = W * 0.46;
    const g = svg.append("g").attr("transform", `translate(${cx},${cy})`);

    const segs: SunburstSeg[] = components
      .filter((c) => c.contributionBps > 0)
      .map((c) => ({
        kind: c.kind, protocol: c.protocol, contributionBps: c.contributionBps,
        plausibilityPct: c.plausibilityPct, componentId: c.componentId,
      }));

    const total = segs.reduce((s, c) => s + c.contributionBps, 0) || 1;
    const maxPlaus = 100;

    if (segs.length === 0) {
      g.append("circle").attr("r", inner).attr("fill", "none")
        .attr("stroke", "rgba(232,255,244,0.12)").attr("stroke-dasharray", "3 6");
    }

    const pie = d3.pie<SunburstSeg>().value((d) => d.contributionBps).sort(null).padAngle(0.012);
    const arcs = pie(segs);

    g.selectAll("path.seg")
      .data(arcs)
      .enter()
      .append("path")
      .attr("class", "seg")
      .attr("fill", (d) => KIND_COLOR[d.data.kind] || "#94A3B8")
      // radius grows with plausibility — fabricated (low) segments stay short
      .attr("fill-opacity", (d) => 0.40 + 0.55 * (d.data.plausibilityPct / maxPlaus))
      .attr("stroke", "#0A1F1A")
      .attr("stroke-width", 1.5)
      .attr("d", (d) => {
        const outer = outerMin + (outerMax - outerMin) * (d.data.plausibilityPct / maxPlaus);
        return d3.arc<any>().innerRadius(inner).outerRadius(outer)
          .startAngle(d.startAngle).endAngle(d.endAngle)({} as any) as string;
      })
      .style("cursor", "pointer")
      .on("mouseenter", function (_e, d) {
        d3.select(this).attr("stroke", "#E8FFF4").attr("stroke-width", 2.5);
        onHover?.(d.data);
      })
      .on("mouseleave", function () {
        d3.select(this).attr("stroke", "#0A1F1A").attr("stroke-width", 1.5);
        onHover?.(null);
      })
      .transition().duration(700).ease(d3.easeCubicOut)
      .attrTween("d", function (d) {
        const outer = outerMin + (outerMax - outerMin) * (d.data.plausibilityPct / maxPlaus);
        const i = d3.interpolate(d.startAngle, d.endAngle);
        return (t: number) => d3.arc<any>().innerRadius(inner).outerRadius(outer)
          .startAngle(d.startAngle).endAngle(i(t))({} as any) as string;
      });

    // share labels on segments
    g.selectAll("text.share")
      .data(arcs)
      .enter()
      .append("text")
      .attr("class", "share")
      .attr("transform", (d) => {
        const a = (d.startAngle + d.endAngle) / 2 - Math.PI / 2;
        const r = (inner + outerMax) / 2;
        return `translate(${Math.cos(a) * r},${Math.sin(a) * r})`;
      })
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .attr("fill", "#0A1F1A")
      .attr("font-size", 10)
      .attr("font-weight", 700)
      .style("pointer-events", "none")
      .text((d) => (d.endAngle - d.startAngle > 0.32 ? d.data.kind.slice(0, 3) : ""));

    // center: claimed APY
    g.append("text").attr("text-anchor", "middle").attr("dy", "-0.2em")
      .attr("fill", "#E8FFF4").attr("font-size", W * 0.12).attr("font-weight", 800)
      .style("font-variant-numeric", "tabular-nums")
      .text((claimedApyBps / 100).toFixed(1) + "%");
    g.append("text").attr("text-anchor", "middle").attr("dy", "1.5em")
      .attr("fill", "#4ADE80").attr("font-size", 10).attr("letter-spacing", "0.18em")
      .text("CLAIMED APY");
    g.append("text").attr("text-anchor", "middle").attr("dy", "3.0em")
      .attr("fill", "rgba(232,255,244,0.5)").attr("font-size", 9).attr("letter-spacing", "0.12em")
      .text(`Σ ${(total / 100).toFixed(1)}% · ${segs.length} comp`);
  }, [components, claimedApyBps, size, onHover]);

  return <svg ref={ref} className="sunburst" width={size} height={size} viewBox={`0 0 ${size} ${size}`} />;
}

// ─── Parent DAG node descriptor ──────────────────────────────────────────────
export interface DagNode {
  vaultId: number;
  label: string;
  apyPct: number;      // verified / decomposed APY in %
  flagged: boolean;    // PHANTOM / REJECTED / CASCADE_FLAGGED
  isCurrent: boolean;
}

// ─── GSAP PARENT DAG: parents flow left → current vault on the right ──────────
export function ParentDag({ parents, current, height = 280 }: {
  parents: DagNode[];
  current: DagNode;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const W = 720;
  const H = height;

  useEffect(() => {
    const flows = svgRef.current?.querySelectorAll<SVGPathElement>("path.dag-flow");
    if (!flows) return;
    const tweens: gsap.core.Tween[] = [];
    flows.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len * 0.18} ${len}`;
      const t = gsap.fromTo(
        p,
        { strokeDashoffset: len },
        { strokeDashoffset: 0, duration: 2.2, repeat: -1, ease: "none" },
      );
      tweens.push(t);
    });
    return () => { tweens.forEach((t) => t.kill()); };
  }, [parents, current]);

  const curX = W - 130;
  const curY = H / 2;
  const n = Math.max(parents.length, 1);
  const gap = H / (n + 1);

  return (
    <svg ref={svgRef} className="dag" width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(232,255,244,0.55)" />
        </marker>
      </defs>
      {parents.length === 0 && (
        <text x={W * 0.32} y={H / 2} fill="rgba(232,255,244,0.4)" fontSize="13" letterSpacing="0.1em">
          ROOT VAULT — no parent dependencies
        </text>
      )}
      {parents.map((p, i) => {
        const px = 110;
        const py = gap * (i + 1);
        const mx = (px + curX) / 2;
        const color = p.flagged ? "#FF3FA4" : "#4ADE80";
        const d = `M ${px + 60} ${py} C ${mx} ${py}, ${mx} ${curY}, ${curX - 60} ${curY}`;
        return (
          <g key={p.vaultId}>
            <path d={d} fill="none" stroke="rgba(232,255,244,0.10)" strokeWidth={p.flagged ? 5 : 3} markerEnd="url(#arrow)" />
            <path className="dag-flow" d={d} fill="none" stroke={color} strokeWidth={p.flagged ? 4 : 2.5}
              style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
            <g transform={`translate(${px},${py})`}>
              <rect x={-60} y={-26} width={120} height={52} rx={10}
                fill={p.flagged ? "rgba(255,63,164,0.10)" : "rgba(74,222,128,0.08)"}
                stroke={color} strokeWidth={1.4} />
              <text x={0} y={-6} textAnchor="middle" fill="#E8FFF4" fontSize={11} fontWeight={700}>{p.label}</text>
              <text x={0} y={12} textAnchor="middle" fill={color} fontSize={13} fontWeight={800}
                style={{ fontVariantNumeric: "tabular-nums" }}>{p.apyPct.toFixed(1)}%</text>
            </g>
          </g>
        );
      })}
      <g transform={`translate(${curX},${curY})`}>
        <rect x={-70} y={-34} width={140} height={68} rx={12}
          fill={current.flagged ? "rgba(255,63,164,0.14)" : "rgba(74,222,128,0.12)"}
          stroke={current.flagged ? "#FF3FA4" : "#4ADE80"} strokeWidth={2}
          style={{ filter: `drop-shadow(0 0 14px ${current.flagged ? "rgba(255,63,164,0.5)" : "rgba(74,222,128,0.4)"})` }} />
        <text x={0} y={-12} textAnchor="middle" fill="#E8FFF4" fontSize={12} fontWeight={800}>{current.label}</text>
        <text x={0} y={8} textAnchor="middle" fill={current.flagged ? "#FF3FA4" : "#4ADE80"} fontSize={16} fontWeight={800}
          style={{ fontVariantNumeric: "tabular-nums" }}>{current.apyPct.toFixed(1)}%</text>
        <text x={0} y={24} textAnchor="middle" fill="rgba(232,255,244,0.5)" fontSize={8} letterSpacing="0.14em">THIS VAULT</text>
      </g>
    </svg>
  );
}
