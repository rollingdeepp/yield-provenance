import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 300_000;

// ─── Lifecycle / vocabulary mirrors of the on-chain contract ────────────────
export const STATUS_LABEL = [
  "REGISTERED", "TRACED", "DECOMPOSED", "SUM_OK",
  "ADJUDICATED", "LABELED", "REJECTED", "FLAGGED",
];
export type Verdict =
  | "VERIFIED" | "PARTIAL" | "PHANTOM_YIELD" | "INCOHERENT" | "CASCADE_FLAGGED" | "";
export const STRATEGY_KINDS = [
  "LENDING", "LP_FEES", "STAKING", "AIRDROP", "REBATE", "PARENT_VAULT", "EXTERNAL",
] as const;
export type StrategyKind = (typeof STRATEGY_KINDS)[number];
export const MIN_BOND_WEI = 5_000_000_000_000_000n; // 0.005 GEN

// ─── Defensive pick: tolerate dict-shaped OR positional array-shaped returns ─
export function pick<T = any>(obj: any, key: string, idx: number, dflt: T): T {
  if (obj == null) return dflt;
  if (typeof obj === "object" && !Array.isArray(obj)) {
    if (key in obj && (obj as any)[key] != null) return (obj as any)[key] as T;
    return dflt;
  }
  if (Array.isArray(obj)) {
    if (idx >= 0 && idx < obj.length && obj[idx] != null) return obj[idx] as T;
    return dflt;
  }
  return dflt;
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface ComponentView {
  componentId: number;
  vaultId: number;
  kind: StrategyKind;
  protocol: string;
  contributionBps: number;
  sourceUrl: string;
  plausibilityPct: number;
  notes: string;
}

export interface VaultView {
  vaultId: number;
  operator: string;
  vaultName: string;
  protocolSlug: string;
  claimedApyBps: number;
  publicNotes: string;
  bondWei: string;
  status: number;
  verdict: Verdict;
  parentVaultIds: number[];
  childVaultIds: number[];
  componentIds: number[];
  evidenceUrl: string;
  evidenceHash: string;
  sumComponentsBps: number;
  sumMatch: boolean;
  plausibilityAvg: number;
  labelIssued: boolean;
  rationale: string;
  registeredEpoch: number;
  decomposedEpoch: number;
  adjudicatedEpoch: number;
  labeledEpoch: number;
  sybilDensity: number;
  cascadeSource: number;
  refundedWei: string;
  slashedWei: string;
}
export interface VaultRow extends VaultView { id: number; }

export interface Counts {
  next: number;
  decomposed: number;
  verified: number;
  phantom: number;
  cascadeFlagged: number;
  labels: number;
  epoch: number;
  totalSlashedWei: string;
}

export interface Constants {
  apyBpsMax: number;
  sumTolBps: number;
  plausibilityMax: number;
  plausibilityTol: number;
  maxComponents: number;
  maxParents: number;
  minComponentBps: number;
  minBondWei: string;
  strategyKinds: string[];
}

export interface DensityInfo {
  protocolSlug: string;
  density: number;
  requiredBondWei: string;
}

// ─── Clients ──────────────────────────────────────────────────────────────
function readClient() { return createClient({ chain: studionet, account: createAccount() }); }
function writeClient(account: Hex) { return createClient({ chain: studionet, account }); }

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([
      client.waitForTransactionReceipt({
        hash: hash as never, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 64,
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function write(account: Hex, functionName: string, args: any[], value: bigint = 0n): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({
    address: CONTRACT_ADDRESS as Hex, functionName, args, value,
  })) as Hex;
  await waitAccepted(wc, h);
}

async function read(functionName: string, args: any[] = []): Promise<any> {
  return readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName, args });
}

// ════════════════════════ WRITES ═══════════════════════════════════════════
export async function registerVault(
  account: Hex,
  vaultName: string,
  protocolSlug: string,
  claimedApyBps: number,
  publicNotes: string,
  parentVaultIdsCsv: string,
  valueWei: bigint,
): Promise<number> {
  await write(
    account, "register_vault",
    [vaultName.trim(), protocolSlug.trim(), Math.trunc(claimedApyBps), publicNotes.trim(), parentVaultIdsCsv.trim()],
    valueWei,
  );
  const c = await getCounts();
  return c.next - 1;
}

export async function submitEvidence(account: Hex, vaultId: number, evidenceUrl: string, evidenceBlob: string): Promise<void> {
  await write(account, "submit_evidence", [vaultId, evidenceUrl.trim(), evidenceBlob.trim()]);
}
export async function decompose(account: Hex, vaultId: number): Promise<void> {
  await write(account, "decompose", [vaultId]);
}
export async function verifySum(account: Hex, vaultId: number): Promise<void> {
  await write(account, "verify_sum", [vaultId]);
}
export async function adjudicate(account: Hex, vaultId: number): Promise<void> {
  await write(account, "adjudicate", [vaultId]);
}
export async function issueLabel(account: Hex, vaultId: number): Promise<void> {
  await write(account, "issue_label", [vaultId]);
}
export async function cascadeFlagDescendants(account: Hex, ancestorVaultId: number): Promise<void> {
  await write(account, "cascade_flag_descendants", [ancestorVaultId]);
}
export async function advanceEpoch(account: Hex): Promise<void> {
  await write(account, "advance_epoch", []);
}
export async function setAdmin(account: Hex, newAdmin: string): Promise<void> {
  await write(account, "set_admin", [newAdmin.trim()]);
}

// ════════════════════════ VIEWS ════════════════════════════════════════════
export async function getVault(vaultId: number): Promise<VaultView> {
  const v = await read("get_vault", [vaultId]);
  return {
    vaultId: Number(pick(v, "vault_id", 0, vaultId)),
    operator: String(pick(v, "operator", 1, "")),
    vaultName: String(pick(v, "vault_name", 2, "")),
    protocolSlug: String(pick(v, "protocol_slug", 3, "")),
    claimedApyBps: Number(pick(v, "claimed_apy_bps", 4, 0)),
    publicNotes: String(pick(v, "public_notes", 5, "")),
    bondWei: String(pick(v, "bond_wei", 6, "0")),
    status: Number(pick(v, "status", 7, 0)),
    verdict: String(pick(v, "verdict", 8, "")) as Verdict,
    parentVaultIds: (pick<any[]>(v, "parent_vault_ids", 9, []) || []).map(Number),
    childVaultIds: (pick<any[]>(v, "child_vault_ids", 10, []) || []).map(Number),
    componentIds: (pick<any[]>(v, "component_ids", 11, []) || []).map(Number),
    evidenceUrl: String(pick(v, "evidence_url", 12, "")),
    evidenceHash: String(pick(v, "evidence_hash", 13, "")),
    sumComponentsBps: Number(pick(v, "sum_components_bps", 14, 0)),
    sumMatch: Boolean(pick(v, "sum_match", 15, false)),
    plausibilityAvg: Number(pick(v, "plausibility_avg", 16, 0)),
    labelIssued: Boolean(pick(v, "label_issued", 17, false)),
    rationale: String(pick(v, "rationale", 18, "")),
    registeredEpoch: Number(pick(v, "registered_epoch", 19, 0)),
    decomposedEpoch: Number(pick(v, "decomposed_epoch", 20, 0)),
    adjudicatedEpoch: Number(pick(v, "adjudicated_epoch", 21, 0)),
    labeledEpoch: Number(pick(v, "labeled_epoch", 22, 0)),
    sybilDensity: Number(pick(v, "sybil_density", 23, 0)),
    cascadeSource: Number(pick(v, "cascade_source", 24, 0)),
    refundedWei: String(pick(v, "refunded_wei", 25, "0")),
    slashedWei: String(pick(v, "slashed_wei", 26, "0")),
  };
}

function toComponent(c: any): ComponentView {
  return {
    componentId: Number(pick(c, "component_id", 0, 0)),
    vaultId: Number(pick(c, "vault_id", 1, 0)),
    kind: String(pick(c, "kind", 2, "EXTERNAL")) as StrategyKind,
    protocol: String(pick(c, "protocol", 3, "")),
    contributionBps: Number(pick(c, "contribution_bps", 4, 0)),
    sourceUrl: String(pick(c, "source_url", 5, "")),
    plausibilityPct: Number(pick(c, "plausibility_pct", 6, 0)),
    notes: String(pick(c, "notes", 7, "")),
  };
}

export async function getComponent(componentId: number): Promise<ComponentView> {
  return toComponent(await read("get_component", [componentId]));
}

export async function getVaultComponents(vaultId: number): Promise<ComponentView[]> {
  const arr = (await read("get_vault_components", [vaultId])) as any[];
  return (arr || []).map(toComponent);
}

export async function getAncestors(vaultId: number): Promise<number[]> {
  const arr = (await read("get_ancestors", [vaultId])) as any[];
  return (arr || []).map(Number);
}
export async function getDescendants(vaultId: number): Promise<number[]> {
  const arr = (await read("get_descendants", [vaultId])) as any[];
  return (arr || []).map(Number);
}
export async function listVaults(): Promise<number[]> {
  const arr = (await read("list_vaults", [])) as any[];
  return (arr || []).map(Number);
}
export async function listVaultsOf(operatorHex: string): Promise<number[]> {
  const arr = (await read("list_vaults_of", [operatorHex])) as any[];
  return (arr || []).map(Number);
}
export async function listVaultsByProtocol(protocolSlug: string): Promise<number[]> {
  const arr = (await read("list_vaults_by_protocol", [protocolSlug])) as any[];
  return (arr || []).map(Number);
}

export async function getProtocolDensity(protocolSlug: string): Promise<DensityInfo> {
  const d = await read("get_protocol_density", [protocolSlug]);
  return {
    protocolSlug: String(pick(d, "protocol_slug", 0, protocolSlug)),
    density: Number(pick(d, "density", 1, 0)),
    requiredBondWei: String(pick(d, "required_bond_wei", 2, "0")),
  };
}

export async function getPoolBalance(): Promise<string> {
  return String(await read("get_pool_balance", []));
}

export async function getCounts(): Promise<Counts> {
  const r = String(await read("get_counts", []));
  const p = r.split("||").map((x) => x.trim());
  return {
    next: Number(p[0] || 0),
    decomposed: Number(p[1] || 0),
    verified: Number(p[2] || 0),
    phantom: Number(p[3] || 0),
    cascadeFlagged: Number(p[4] || 0),
    labels: Number(p[5] || 0),
    epoch: Number(p[6] || 0),
    totalSlashedWei: String(p[7] || "0"),
  };
}

export async function getConstants(): Promise<Constants> {
  const c = await read("get_constants", []);
  return {
    apyBpsMax: Number(pick(c, "APY_BPS_MAX", 0, 50000)),
    sumTolBps: Number(pick(c, "SUM_TOL_BPS", 1, 300)),
    plausibilityMax: Number(pick(c, "PLAUSIBILITY_MAX", 2, 100)),
    plausibilityTol: Number(pick(c, "PLAUSIBILITY_TOL", 3, 12)),
    maxComponents: Number(pick(c, "MAX_COMPONENTS_PER_VAULT", 4, 8)),
    maxParents: Number(pick(c, "MAX_PARENT_VAULTS", 5, 6)),
    minComponentBps: Number(pick(c, "MIN_COMPONENT_BPS", 6, 10)),
    minBondWei: String(pick(c, "MIN_BOND_WEI", 7, "5000000000000000")),
    strategyKinds: (pick<any[]>(c, "STRATEGY_KINDS", 8, []) || []).map(String),
  };
}

// ─── List helper for the table ───────────────────────────────────────────────
export async function listAll(maxRows = 60): Promise<VaultRow[]> {
  const ids = await listVaults();
  if (ids.length === 0) return [];
  const slice = ids.slice(-maxRows).reverse();
  const rows = await Promise.all(
    slice.map(async (id) => {
      try { return { id, ...(await getVault(id)) }; } catch { return null; }
    }),
  );
  return rows.filter((r): r is VaultRow => r !== null);
}
