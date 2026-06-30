import { useEffect, useMemo, useState, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import {
  registerVault, submitEvidence, decompose, verifySum, adjudicate, issueLabel,
  cascadeFlagDescendants, advanceEpoch, setAdmin,
  getVault, getVaultComponents, getComponent, getAncestors, getDescendants,
  listVaultsOf, listVaultsByProtocol, getProtocolDensity,
  getPoolBalance, getCounts, getConstants, listAll,
  STATUS_LABEL, STRATEGY_KINDS,
  VaultView, VaultRow, ComponentView, Counts, Constants,
} from "./contractService";
import { Sunburst, ParentDag, KIND_COLOR, type SunburstSeg, type DagNode } from "./gauges";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;

function shortAddr(a: string): string { return a && a.length > 12 ? `${a.slice(0, 6)}\u2026${a.slice(-4)}` : a || "—"; }
function gen(w: string): string { try { const v = formatEther(BigInt(w || "0")); return v.length > 9 ? Number(v).toFixed(5) : v; } catch { return "0"; } }
function pctBps(b: number): string { return (b / 100).toFixed(2) + "%"; }
async function copyText(t: string) { try { await navigator.clipboard.writeText(t); } catch { /* clipboard blocked */ } }

function verdictClass(v: string): string {
  if (v === "VERIFIED") return "v-ok";
  if (v === "PARTIAL") return "v-partial";
  if (v === "PHANTOM_YIELD" || v === "INCOHERENT") return "v-phantom";
  if (v === "CASCADE_FLAGGED") return "v-cascade";
  return "v-pend";
}

const PHANTOM_VERDICTS = ["PHANTOM_YIELD", "INCOHERENT", "CASCADE_FLAGGED"];

export function App({ onHome }: { onHome?: () => void }) {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;

  const [rows, setRows] = useState<VaultRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ next: 0, decomposed: 0, verified: 0, phantom: 0, cascadeFlagged: 0, labels: 0, epoch: 0, totalSlashedWei: "0" });
  const [pool, setPool] = useState("0");
  const [consts, setConsts] = useState<Constants | null>(null);
  const [loading, setLoading] = useState(true);
  const [netErr, setNetErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [selId, setSelId] = useState<number | null>(null);
  const [sel, setSel] = useState<VaultView | null>(null);
  const [comps, setComps] = useState<ComponentView[]>([]);
  const [parentNodes, setParentNodes] = useState<DagNode[]>([]);
  const [hoverSeg, setHoverSeg] = useState<SunburstSeg | null>(null);

  // register form
  const [rName, setRName] = useState("");
  const [rSlug, setRSlug] = useState("");
  const [rApy, setRApy] = useState("");
  const [rNotes, setRNotes] = useState("");
  const [rParents, setRParents] = useState("");
  const [rBond, setRBond] = useState("0.05");

  // evidence form
  const [eUrl, setEUrl] = useState("");
  const [eBlob, setEBlob] = useState("");

  // admin
  const [newAdmin, setNewAdmin] = useState("");

  // tools
  const [tProtocol, setTProtocol] = useState("");
  const [tOperator, setTOperator] = useState("");
  const [tCompId, setTCompId] = useState("");
  const [toolOut, setToolOut] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [r, c, p] = await Promise.all([listAll(60), getCounts(), getPoolBalance()]);
      setRows(r); setCounts(c); setPool(p); setNetErr(false);
      if (!consts) { try { setConsts(await getConstants()); } catch { /* ignore */ } }
    } catch { setNetErr(true); } finally { setLoading(false); }
  }, [consts]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [refresh]);

  const loadVault = useCallback(async (id: number) => {
    setSelId(id);
    try {
      const v = await getVault(id);
      setSel(v);
      const cs = await getVaultComponents(id);
      setComps(cs);
      // build parent DAG nodes
      const nodes: DagNode[] = await Promise.all(
        v.parentVaultIds.map(async (pid) => {
          try {
            const pv = await getVault(pid);
            return {
              vaultId: pid, label: `#${pid} ${pv.protocolSlug}`.slice(0, 16),
              apyPct: pv.sumComponentsBps > 0 ? pv.sumComponentsBps / 100 : pv.claimedApyBps / 100,
              flagged: PHANTOM_VERDICTS.includes(pv.verdict) || pv.status === 6 || pv.status === 7,
              isCurrent: false,
            };
          } catch {
            return { vaultId: pid, label: `#${pid}`, apyPct: 0, flagged: false, isCurrent: false };
          }
        }),
      );
      setParentNodes(nodes);
    } catch { setNote("could not load vault"); }
  }, []);

  // auto-select newest vault once rows load
  useEffect(() => {
    if (selId === null && rows.length > 0) loadVault(rows[0].id);
  }, [rows, selId, loadVault]);

  async function run(label: string, fn: () => Promise<void>) {
    if (!acct) { setNote("connect a wallet first"); return; }
    setBusy(label); setNote("");
    try { await fn(); await refresh(); if (selId !== null) await loadVault(selId); setNote(`${label} ✓`); }
    catch (e: any) { setNote(`${label} failed: ${String(e?.message || e).slice(0, 200)}`); }
    finally { setBusy(null); }
  }

  // ── write handlers ──
  const onRegister = () => run("register_vault", async () => {
    const apyBps = Math.round(parseFloat(rApy || "0") * 100);
    const id = await registerVault(acct!, rName, rSlug, apyBps, rNotes, rParents, parseEther(rBond || "0"));
    setRName(""); setRApy(""); setRNotes(""); setRParents("");
    await loadVault(id);
  });
  const onSubmitEvidence = () => run("submit_evidence", async () => {
    if (selId === null) throw new Error("select a vault");
    await submitEvidence(acct!, selId, eUrl, eBlob);
    setEUrl(""); setEBlob("");
  });
  const onDecompose = () => run("decompose", async () => { if (selId === null) throw new Error("select a vault"); await decompose(acct!, selId); });
  const onVerifySum = () => run("verify_sum", async () => { if (selId === null) throw new Error("select a vault"); await verifySum(acct!, selId); });
  const onAdjudicate = () => run("adjudicate", async () => { if (selId === null) throw new Error("select a vault"); await adjudicate(acct!, selId); });
  const onIssueLabel = () => run("issue_label", async () => { if (selId === null) throw new Error("select a vault"); await issueLabel(acct!, selId); });
  const onCascade = () => run("cascade_flag_descendants", async () => { if (selId === null) throw new Error("select a vault"); await cascadeFlagDescendants(acct!, selId); });
  const onAdvanceEpoch = () => run("advance_epoch", async () => { await advanceEpoch(acct!); });
  const onSetAdmin = () => run("set_admin", async () => { if (!newAdmin) throw new Error("admin address required"); await setAdmin(acct!, newAdmin); setNewAdmin(""); });

  // ── tools (views) ──
  const onProtocolTools = async () => {
    setToolOut("…");
    try {
      const [d, ids] = await Promise.all([getProtocolDensity(tProtocol), listVaultsByProtocol(tProtocol)]);
      setToolOut(`protocol "${d.protocolSlug}" · density=${d.density} · required bond=${gen(d.requiredBondWei)} GEN · vaults=[${ids.join(", ")}]`);
    } catch (e: any) { setToolOut("error: " + String(e?.message || e).slice(0, 160)); }
  };
  const onOperatorTools = async () => {
    setToolOut("…");
    try { const ids = await listVaultsOf(tOperator.trim()); setToolOut(`operator ${shortAddr(tOperator)} vaults=[${ids.join(", ")}]`); }
    catch (e: any) { setToolOut("error: " + String(e?.message || e).slice(0, 160)); }
  };
  const onComponentTool = async () => {
    setToolOut("…");
    try { const c = await getComponent(Number(tCompId)); setToolOut(`component #${c.componentId} · vault ${c.vaultId} · ${c.kind} · ${c.protocol} · ${pctBps(c.contributionBps)} · plausibility ${c.plausibilityPct}% · ${c.sourceUrl || "(no src)"} · ${c.notes}`); }
    catch (e: any) { setToolOut("error: " + String(e?.message || e).slice(0, 160)); }
  };
  const onDagTools = async () => {
    if (selId === null) { setToolOut("select a vault"); return; }
    setToolOut("…");
    try {
      const [anc, desc] = await Promise.all([getAncestors(selId), getDescendants(selId)]);
      setToolOut(`vault #${selId} ancestors=[${anc.join(", ")}] descendants=[${desc.join(", ")}]`);
    } catch (e: any) { setToolOut("error: " + String(e?.message || e).slice(0, 160)); }
  };

  const currentNode: DagNode | null = useMemo(() => {
    if (!sel) return null;
    return {
      vaultId: sel.vaultId,
      label: `#${sel.vaultId} ${sel.protocolSlug}`.slice(0, 18),
      apyPct: sel.sumComponentsBps > 0 ? sel.sumComponentsBps / 100 : sel.claimedApyBps / 100,
      flagged: PHANTOM_VERDICTS.includes(sel.verdict) || sel.status === 6 || sel.status === 7,
      isCurrent: true,
    };
  }, [sel]);

  const isPhantom = sel ? PHANTOM_VERDICTS.includes(sel.verdict) : false;
  const decomposedPct = sel ? sel.sumComponentsBps / 100 : 0;
  const claimedPct = sel ? sel.claimedApyBps / 100 : 0;

  return (
    <div className="app">
      <div className="aurora" aria-hidden />
      <header className="topbar glass">
        <div className="brand">
          <div className="mark" />
          <div>
            <h1>YIELD&nbsp;PROVENANCE</h1>
            <p>APY strategy decomposition · sum-check · parent DAG — on GenLayer</p>
          </div>
        </div>
        <div className="topright">
          {onHome && <button className="home-btn" onClick={onHome}>← Home</button>}
          <span className="addr-chip" title={CONTRACT_ADDRESS} onClick={() => copyText(CONTRACT_ADDRESS)}>
            {shortAddr(CONTRACT_ADDRESS)}
          </span>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
      </header>

      <div className="statstrip glass">
        <Stat k="vaults" v={String(counts.next)} />
        <Stat k="decomposed" v={String(counts.decomposed)} />
        <Stat k="verified" v={String(counts.verified)} accent="ok" />
        <Stat k="phantom" v={String(counts.phantom)} accent="phantom" />
        <Stat k="cascade-flagged" v={String(counts.cascadeFlagged)} accent="cascade" />
        <Stat k="labels" v={String(counts.labels)} />
        <Stat k="epoch" v={String(counts.epoch)} />
        <Stat k="pool" v={`${gen(pool)} GEN`} />
        <Stat k="slashed" v={`${gen(counts.totalSlashedWei)} GEN`} accent="phantom" />
      </div>

      {netErr && <div className="banner err">network unreachable — retrying…</div>}

      {/* ── SUM-CHECK BANNER ── */}
      {sel && (
        <div className={`sumbanner glass ${isPhantom ? "phantom" : sel.sumMatch ? "match" : "drift"}`}>
          <div className="sb-side">
            <span className="sb-label">CLAIMED</span>
            <span className="sb-big">{claimedPct.toFixed(2)}<i>%</i></span>
          </div>
          <div className="sb-vs">
            <span className="sb-op">vs</span>
            <span className="sb-delta">
              {sel.sumMatch ? "WITHIN TOLERANCE" : `Δ ${Math.abs(claimedPct - decomposedPct).toFixed(2)}%`}
            </span>
          </div>
          <div className="sb-side">
            <span className="sb-label">DECOMPOSED</span>
            <span className="sb-big">{decomposedPct.toFixed(2)}<i>%</i></span>
          </div>
          <div className={`sb-verdict ${verdictClass(sel.verdict)}`}>
            {sel.verdict || STATUS_LABEL[sel.status] || "PENDING"}
          </div>
        </div>
      )}
      {isPhantom && (
        <div className="phantom-bar">
          ⚠ {sel?.verdict === "CASCADE_FLAGGED"
            ? `CASCADE_FLAGGED — inherited from vault #${sel?.cascadeSource}`
            : "PHANTOM YIELD DETECTED — components do not substantiate the claimed APY"}
        </div>
      )}

      <main className="grid">
        {/* ── SIGNATURE: SUNBURST ── */}
        <section className="card glass sunburst-card">
          <h2>STRATEGY SUNBURST</h2>
          {sel ? (
            <div className="sb-wrap">
              <Sunburst components={comps} claimedApyBps={sel.claimedApyBps} size={360} onHover={setHoverSeg} />
              <div className="sb-readout">
                {hoverSeg ? (
                  <>
                    <span className="ro-kind" style={{ color: KIND_COLOR[hoverSeg.kind] }}>{hoverSeg.kind}</span>
                    <span className="ro-proto">{hoverSeg.protocol || "—"}</span>
                    <div className="ro-row"><span>contribution</span><b>{pctBps(hoverSeg.contributionBps)}</b></div>
                    <div className="ro-row"><span>plausibility</span><b className={hoverSeg.plausibilityPct >= 75 ? "ok" : hoverSeg.plausibilityPct >= 40 ? "warn" : "bad"}>{hoverSeg.plausibilityPct}%</b></div>
                    <div className="ro-bar"><i style={{ width: `${hoverSeg.plausibilityPct}%`, background: KIND_COLOR[hoverSeg.kind] }} /></div>
                  </>
                ) : (
                  <span className="ro-hint">hover a segment for its plausibility score · arc length ∝ bps · radius & opacity ∝ plausibility</span>
                )}
              </div>
            </div>
          ) : <p className="empty">select a vault to inspect its strategy decomposition</p>}
          <div className="legend">
            {STRATEGY_KINDS.map((k) => (
              <span key={k} className="leg"><i style={{ background: KIND_COLOR[k as keyof typeof KIND_COLOR] }} />{k}</span>
            ))}
          </div>
        </section>

        {/* ── VAULT METADATA ── */}
        <section className="card glass meta-card">
          <h2>VAULT METADATA</h2>
          {sel ? (
            <div className="meta">
              <Field k="vault_id" v={`#${sel.vaultId}`} />
              <Field k="vault_name" v={sel.vaultName} />
              <Field k="protocol_slug" v={sel.protocolSlug} />
              <Field k="operator" v={shortAddr(sel.operator)} onClick={() => copyText(sel.operator)} />
              <Field k="claimed_apy_bps" v={`${sel.claimedApyBps} (${pctBps(sel.claimedApyBps)})`} />
              <Field k="status" v={`${sel.status} · ${STATUS_LABEL[sel.status] || "?"}`} />
              <Field k="verdict" v={sel.verdict || "—"} cls={verdictClass(sel.verdict)} />
              <Field k="sum_components_bps" v={`${sel.sumComponentsBps} (${pctBps(sel.sumComponentsBps)})`} />
              <Field k="sum_match" v={sel.sumMatch ? "true" : "false"} cls={sel.sumMatch ? "ok" : "bad"} />
              <Field k="plausibility_avg" v={`${sel.plausibilityAvg}%`} />
              <Field k="label_issued" v={sel.labelIssued ? "true" : "false"} cls={sel.labelIssued ? "ok" : ""} />
              <Field k="bond_wei" v={`${gen(sel.bondWei)} GEN`} />
              <Field k="refunded_wei" v={`${gen(sel.refundedWei)} GEN`} cls="ok" />
              <Field k="slashed_wei" v={`${gen(sel.slashedWei)} GEN`} cls={Number(sel.slashedWei) > 0 ? "bad" : ""} />
              <Field k="sybil_density" v={String(sel.sybilDensity)} />
              <Field k="cascade_source" v={sel.cascadeSource ? `#${sel.cascadeSource}` : "—"} />
              <Field k="parent_vault_ids" v={sel.parentVaultIds.length ? sel.parentVaultIds.join(", ") : "—"} />
              <Field k="child_vault_ids" v={sel.childVaultIds.length ? sel.childVaultIds.join(", ") : "—"} />
              <Field k="component_ids" v={sel.componentIds.length ? sel.componentIds.join(", ") : "—"} />
              <Field k="registered_epoch" v={String(sel.registeredEpoch)} />
              <Field k="decomposed_epoch" v={String(sel.decomposedEpoch)} />
              <Field k="adjudicated_epoch" v={String(sel.adjudicatedEpoch)} />
              <Field k="labeled_epoch" v={String(sel.labeledEpoch)} />
            </div>
          ) : <p className="empty">no vault selected</p>}
        </section>

        {/* ── PARENT DAG ── */}
        <section className="card glass dag-card">
          <h2>PARENT DAG <span className="sub">composable yield provenance — flagged parents flow magenta →</span></h2>
          {sel && currentNode ? (
            <ParentDag parents={parentNodes} current={currentNode} height={300} />
          ) : <p className="empty">no vault selected</p>}
        </section>

        {/* ── EVIDENCE / VERDICT GLASS CARDS ── */}
        <section className="card glass evidence-card">
          <h2>EVIDENCE & VERDICT</h2>
          {sel ? (
            <>
              <div className="ev-row">
                <span className="ev-k">evidence_url</span>
                {sel.evidenceUrl
                  ? <a className="ev-link" href={sel.evidenceUrl} target="_blank" rel="noreferrer">{sel.evidenceUrl}</a>
                  : <span className="muted">— not submitted —</span>}
              </div>
              <div className="ev-row"><span className="ev-k">evidence_hash</span><code>{sel.evidenceHash || "—"}</code></div>
              <div className="ev-row"><span className="ev-k">public_notes</span><span>{sel.publicNotes || "—"}</span></div>
              <div className="ev-row col"><span className="ev-k">rationale</span><p className="rationale">{sel.rationale || "—"}</p></div>
            </>
          ) : <p className="empty">no vault selected</p>}
        </section>

        {/* ── COMPONENTS TABLE ── */}
        <section className="card glass comp-card">
          <h2>STRATEGY COMPONENTS</h2>
          {comps.length ? (
            <table className="ctable">
              <thead><tr><th>id</th><th>kind</th><th>protocol</th><th>bps</th><th>plaus</th><th>source</th><th>notes</th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.componentId}>
                    <td>#{c.componentId}</td>
                    <td><span className="kpill" style={{ borderColor: KIND_COLOR[c.kind], color: KIND_COLOR[c.kind] }}>{c.kind}</span></td>
                    <td>{c.protocol || "—"}</td>
                    <td className="num">{pctBps(c.contributionBps)}</td>
                    <td className="num"><span className={c.plausibilityPct >= 75 ? "ok" : c.plausibilityPct >= 40 ? "warn" : "bad"}>{c.plausibilityPct}%</span></td>
                    <td>{c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer">src</a> : "—"}</td>
                    <td className="notes">{c.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty">no components — run decompose</p>}
        </section>

        {/* ── LIFECYCLE ACTIONS ── */}
        <section className="card glass action-card">
          <h2>LIFECYCLE — VAULT {selId !== null ? `#${selId}` : ""}</h2>
          <div className="ev-form">
            <input placeholder="evidence_url (https://…)" value={eUrl} onChange={(e) => setEUrl(e.target.value)} />
            <textarea placeholder="evidence_blob (≥30 chars: strategy breakdown, sources…)" value={eBlob} onChange={(e) => setEBlob(e.target.value)} rows={3} />
            <button disabled={!!busy || selId === null} onClick={onSubmitEvidence}>submit_evidence</button>
          </div>
          <div className="actions">
            <button className="step" disabled={!!busy || selId === null} onClick={onDecompose}>① decompose (LLM)</button>
            <button className="step" disabled={!!busy || selId === null} onClick={onVerifySum}>② verify_sum</button>
            <button className="step" disabled={!!busy || selId === null} onClick={onAdjudicate}>③ adjudicate (LLM)</button>
            <button className="step" disabled={!!busy || selId === null} onClick={onIssueLabel}>④ issue_label</button>
            <button className="step warn" disabled={!!busy || selId === null} onClick={onCascade}>cascade_flag_descendants</button>
          </div>
        </section>

        {/* ── REGISTER FORM ── */}
        <section className="card glass register-card">
          <h2>REGISTER VAULT <span className="sub">payable · min bond {consts ? gen(consts.minBondWei) : "0.005"} GEN</span></h2>
          <div className="reg-grid">
            <label>vault_name<input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Stable Yield Vault" /></label>
            <label>protocol_slug<input value={rSlug} onChange={(e) => setRSlug(e.target.value)} placeholder="aave-v3" /></label>
            <label>claimed APY %<input value={rApy} onChange={(e) => setRApy(e.target.value)} placeholder="20" inputMode="decimal" /></label>
            <label>bond (GEN)<input value={rBond} onChange={(e) => setRBond(e.target.value)} placeholder="0.05" inputMode="decimal" /></label>
            <label className="wide">parent_vault_ids (csv)<input value={rParents} onChange={(e) => setRParents(e.target.value)} placeholder="e.g. 0,1" /></label>
            <label className="wide">public_notes<input value={rNotes} onChange={(e) => setRNotes(e.target.value)} placeholder="lending + LP fees + staking" /></label>
          </div>
          <button className="primary" disabled={!!busy || !isConnected} onClick={onRegister}>register_vault →</button>
        </section>

        {/* ── ADMIN ── */}
        <section className="card glass admin-card">
          <h2>ADMIN / KEEPER</h2>
          <div className="admin-row">
            <button disabled={!!busy || !isConnected} onClick={onAdvanceEpoch}>advance_epoch (now {counts.epoch})</button>
          </div>
          <div className="admin-row">
            <input placeholder="new_admin 0x…" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
            <button disabled={!!busy || !isConnected} onClick={onSetAdmin}>set_admin</button>
          </div>
          {consts && (
            <div className="consts">
              <span>APY_MAX {pctBps(consts.apyBpsMax)}</span>
              <span>SUM_TOL {pctBps(consts.sumTolBps)}</span>
              <span>PLAUS_TOL {consts.plausibilityTol}</span>
              <span>MAX_COMP {consts.maxComponents}</span>
              <span>MAX_PARENTS {consts.maxParents}</span>
              <span>MIN_COMP_BPS {consts.minComponentBps}</span>
            </div>
          )}
        </section>

        {/* ── TOOLS / VIEW EXPLORER ── */}
        <section className="card glass tools-card">
          <h2>VIEW EXPLORER</h2>
          <div className="tool-row">
            <input placeholder="protocol_slug" value={tProtocol} onChange={(e) => setTProtocol(e.target.value)} />
            <button disabled={!tProtocol} onClick={onProtocolTools}>density + by_protocol</button>
          </div>
          <div className="tool-row">
            <input placeholder="operator 0x…" value={tOperator} onChange={(e) => setTOperator(e.target.value)} />
            <button disabled={!tOperator} onClick={onOperatorTools}>list_vaults_of</button>
          </div>
          <div className="tool-row">
            <input placeholder="component_id" value={tCompId} onChange={(e) => setTCompId(e.target.value)} inputMode="numeric" />
            <button disabled={!tCompId} onClick={onComponentTool}>get_component</button>
          </div>
          <div className="tool-row">
            <button disabled={selId === null} onClick={onDagTools}>get_ancestors + descendants of {selId !== null ? `#${selId}` : "—"}</button>
            {acct && <button onClick={() => { setTOperator(acct); }}>use my address</button>}
          </div>
          {toolOut && <pre className="toolout">{toolOut}</pre>}
        </section>

        {/* ── VAULT LIST ── */}
        <section className="card glass list-card">
          <h2>VAULTS {loading && <span className="sub">loading…</span>}</h2>
          <table className="vtable">
            <thead><tr><th>id</th><th>protocol</th><th>claimed</th><th>decomp</th><th>status</th><th>verdict</th><th>plaus</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selId === r.id ? "active" : ""} onClick={() => loadVault(r.id)}>
                  <td>#{r.id}</td>
                  <td>{r.protocolSlug}</td>
                  <td className="num">{pctBps(r.claimedApyBps)}</td>
                  <td className="num">{r.sumComponentsBps ? pctBps(r.sumComponentsBps) : "—"}</td>
                  <td><span className="spill">{STATUS_LABEL[r.status] || r.status}</span></td>
                  <td><span className={`vpill ${verdictClass(r.verdict)}`}>{r.verdict || "—"}</span></td>
                  <td className="num">{r.plausibilityAvg ? `${r.plausibilityAvg}%` : "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && <tr><td colSpan={7} className="empty">no vaults yet — register one</td></tr>}
            </tbody>
          </table>
        </section>
      </main>

      {note && <div className="toast glass" onClick={() => setNote("")}>{note}</div>}
      {busy && <div className="busy glass">⏳ {busy} — awaiting consensus…</div>}

      <footer>
        <span>contract {shortAddr(CONTRACT_ADDRESS)}</span>
        <span>GenLayer Studionet · 07-flux</span>
      </footer>
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className={`stat ${accent ? "a-" + accent : ""}`}>
      <span className="sv">{v}</span>
      <span className="sk">{k}</span>
    </div>
  );
}

function Field({ k, v, cls, onClick }: { k: string; v: string; cls?: string; onClick?: () => void }) {
  return (
    <div className="field" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <span className="fk">{k}</span>
      <span className={`fv ${cls || ""}`}>{v}</span>
    </div>
  );
}
