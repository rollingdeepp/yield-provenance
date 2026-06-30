import { useEffect, useRef } from "react";
import "./Landing.css";

const STEPS = [
  { n: "01", t: "Register vault", d: "An operator bonds GEN and registers a vault with its claimed APY and parent vaults." },
  { n: "02", t: "Submit evidence", d: "A strategy breakdown and sources are attached: lending, LP fees, staking, incentives." },
  { n: "03", t: "Decompose", d: "GenLayer validators split the claimed yield into weighted components with plausibility scores." },
  { n: "04", t: "Verify the sum", d: "Components must add up to the claim within tolerance, or the vault drifts into phantom territory." },
  { n: "05", t: "Adjudicate & label", d: "A verdict is issued on-chain; flagged parents cascade down the provenance DAG." },
];

const METRICS = [
  { v: "0–100", k: "plausibility / component" },
  { v: "Σ", k: "sum-check vs claim" },
  { v: "DAG", k: "parent provenance" },
  { v: "LLM", k: "validator consensus" },
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = root.current?.querySelectorAll("[data-reveal]");
    if (!els) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.16 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="ypl" ref={root}>
      <div className="ypl-aurora" aria-hidden />

      <nav className="ypl-nav">
        <div className="ypl-brand">
          <span className="ypl-mark" aria-hidden />
          <b>YIELD&nbsp;PROVENANCE</b>
        </div>
      </nav>

      {/* Hero: centered, full-bleed chart band behind the headline */}
      <header className="ypl-hero">
        <div className="ypl-hero-bg" aria-hidden>
          <img src="./landing/charts.jpg" alt="" loading="eager" />
        </div>
        <div className="ypl-hero-inner">
          <span className="ypl-kicker" data-reveal>APY decomposition · GenLayer Studionet</span>
          <h1 data-reveal>
            Where does the<br /><em>yield actually come from?</em>
          </h1>
          <p data-reveal>
            Vaults claim a number. This protocol breaks that number into its real components, checks
            that they sum to the claim, and flags the yield that has no source.
          </p>
          <div className="ypl-actions" data-reveal>
            <button className="ypl-enter" onClick={onEnter}>Enter the explorer</button>
            <a className="ypl-ghost" href="#how">How it works</a>
          </div>
          <div className="ypl-sumchip" data-reveal>
            <span>CLAIMED</span><b>20.00%</b>
            <i>vs</i>
            <span>DECOMPOSED</span><b className="warn">12.40%</b>
            <em className="verdict">PHANTOM</em>
          </div>
        </div>
      </header>

      {/* Metrics strip — distinct from token-unlock's band layout */}
      <section className="ypl-metrics" data-reveal>
        {METRICS.map((m) => (
          <div className="ypl-metric" key={m.k}>
            <b>{m.v}</b>
            <span>{m.k}</span>
          </div>
        ))}
      </section>

      {/* Split feature: green uptrend image + provenance copy */}
      <section className="ypl-split">
        <div className="ypl-split-copy" data-reveal>
          <h2>Composable yield inherits its parents' risk.</h2>
          <p>
            Vaults reference parent vaults. When a parent is flagged as phantom, the flag cascades
            down the DAG to every descendant that built on top of it. Provenance is not optional.
          </p>
        </div>
        <figure className="ypl-split-art" data-reveal>
          <img src="./landing/provenance.jpg" alt="A rising green market chart indicating yield growth" loading="lazy" />
          <figcaption>Decomposed yield</figcaption>
        </figure>
      </section>

      <section className="ypl-how" id="how">
        <span className="ypl-eyebrow" data-reveal>How it works</span>
        <div className="ypl-steps">
          {STEPS.map((s) => (
            <div className="ypl-step" key={s.n} data-reveal>
              <span className="ypl-step-n">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="ypl-foot">
        <span>GenLayer Studionet · yield-provenance</span>
      </footer>
    </div>
  );
}
