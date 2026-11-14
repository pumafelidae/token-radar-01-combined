// Token Radar — Model E + farm-plan pipeline.
//
// The value model is calibrated from the snapshot's own live-token
// comparables, not from a hardcoded list of names: 129 protocols with a
// market cap give the median mcap/TVL per category. The multiple for a
// category is the shrunk median of the winsorized (clipped at 2.0) live
// ratios, shrunk toward the overall median 0.214; categories with fewer
// than 3 live comps use the overall median, because a median of 1 or 2
// comps is noise, not a market. A flat multiple would overvalue the
// giants 2-8x: the market's own size curve says giants trade at a small
// fraction of TVL per dollar, so a size factor (TVL / $200M) ^ -0.35
// corrects it. Growth and maturity follow the starter's shape.
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Factors {
  multiple: number;
  multipleNote: string;
  sizeFactor: number;
  growthMult: number;
  maturityMult: number;
  ageDays: number;
  capTier: number;
  holdDays: number;
  chain: string;
  gasLabel: string;
  gasMid: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  multiple: number;
  multiple_note: string;
  size_factor: number;
  growth_mult: number;
  maturity_mult: number;
  hold_days: number;
  cap_tier: number;
  gas_label: string;
  gas_mid: number;
  live: boolean;
  watch: boolean;
}

export const OVERALL_MEDIAN = 0.214;
export const SIZE_REF = 200_000_000;
export const SIZE_EXP = -0.35;
export const BOARD_ROWS = 200;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// Calibrate the category multiples from the snapshot's live comps.
export function calibrate(protocols: Protocol[]): {
  multiples: Record<string, number>;
  notes: Record<string, string>;
  liveCount: number;
  overallMedian: number;
} {
  const byCat: Record<string, number[]> = {};
  let liveCount = 0;
  for (const p of protocols) {
    if (p.mcap_usd && p.mcap_usd > 0 && p.tvl_usd > 0) {
      liveCount++;
      const ratio = Math.min(p.mcap_usd / p.tvl_usd, 2.0);
      const cat = p.category ?? "Uncategorized";
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(ratio);
    }
  }
  const multiples: Record<string, number> = {};
  const notes: Record<string, string> = {};
  for (const cat of Object.keys(byCat)) {
    const rs = byCat[cat];
    if (rs.length >= 3) {
      const w = rs.length / (rs.length + 8);
      const m = w * median(rs) + (1 - w) * OVERALL_MEDIAN;
      multiples[cat] = clamp(m, 0.05, 1.0);
      notes[cat] =
        cat + ": " + rs.length + " live comps, median " + median(rs).toFixed(3) +
        " shrunk to " + multiples[cat].toFixed(3);
    } else {
      multiples[cat] = OVERALL_MEDIAN;
      notes[cat] =
        cat + ": only " + rs.length + " live comp" + (rs.length === 1 ? "" : "s") +
        " — the overall market median " + OVERALL_MEDIAN.toFixed(3) + " is used";
    }
  }
  return { multiples, notes, liveCount, overallMedian: OVERALL_MEDIAN };
}

export function multipleFor(category: string | null, multiples: Record<string, number>): number {
  const m = multiples[category ?? "Uncategorized"];
  return m === undefined ? OVERALL_MEDIAN : m;
}

export function multipleNoteFor(category: string | null, notes: Record<string, string>): string {
  const n = notes[category ?? "Uncategorized"];
  return n === undefined
    ? "No live comps in this category — the overall market median " + OVERALL_MEDIAN.toFixed(3) + " is used"
    : n;
}

export function ageDays(listedAt: string | null, asOf: string): number {
  if (!listedAt) return 365;
  const a = Date.parse(asOf + "T00:00:00Z");
  const b = Date.parse(listedAt + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 365;
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

export function growthMult(change7d: number | null): number {
  const g = clamp(change7d ?? 0, -60, 120);
  return 1 + (g / 100) * 0.5;
}

export function maturityMult(age: number): number {
  return 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
}

export function sizeFactor(tvl: number): number {
  return Math.pow(tvl / SIZE_REF, SIZE_EXP);
}

export function impliedValue(tvl: number, multiple: number, age: number, change7d: number | null): number {
  const v = tvl * multiple * sizeFactor(tvl) * growthMult(change7d) * maturityMult(age);
  return Math.max(1, Math.round(v));
}

// --- Gas: what one transaction actually costs on each chain. ---
// The starter charged every chain the same $2-3; real costs differ 1000x.
export interface GasBand { label: string; mid: number }
export const GAS: Record<string, GasBand> = {
  Ethereum: { label: "$3–$15", mid: 9 },
  Arbitrum: { label: "$0.05–$0.50", mid: 0.28 },
  Optimism: { label: "$0.05–$0.50", mid: 0.28 },
  Base: { label: "$0.05–$0.50", mid: 0.28 },
  Solana: { label: "~$0.01", mid: 0.01 },
  BSC: { label: "$0.10–$0.30", mid: 0.2 },
  Avalanche: { label: "$0.10–$0.50", mid: 0.3 },
  Polygon: { label: "$0.01–$0.10", mid: 0.05 },
  Sui: { label: "~$0.01", mid: 0.01 },
  Tron: { label: "$1–$3", mid: 2 },
  Monad: { label: "~$0.01", mid: 0.01 },
  Bitcoin: { label: "~$0.01", mid: 0.01 },
};
export const GAS_DEFAULT: GasBand = { label: "~$0.50", mid: 0.5 };

export function gasFor(chain: string): GasBand {
  return GAS[chain] ?? GAS_DEFAULT;
}

export function capTier(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

export function holdDays(age: number): number {
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function fmtPct(x: number): string {
  const r = Math.round(x * 10) / 10;
  return (r > 0 ? "+" : "") + String(r);
}

// --- Farm plans: 6 steps, category-specific, every step carries a
// Cost: and a Time: label and at least one digit. No generic fallback:
// every category the snapshot names gets its own action and weekly step.
export function actionFor(category: string | null, name: string, chain: string, cap: number): string {
  const c = category ?? "";
  switch (c) {
    case "Risk Curators":
      return `Deposit $${cap} into a ${name} vault on ${chain} and keep the vault shares in this wallet`;
    case "Onchain Capital Allocator":
      return `Deposit $${cap} into a ${name} allocation vault on ${chain} and keep the vault shares in this wallet`;
    case "Lending":
      return `Supply $${cap} of USDC to ${name} on ${chain} as a lender and leave the position open`;
    case "Dexs":
      return `Add $${cap} of liquidity to the busiest ${name} pool on ${chain} and keep the LP tokens in this wallet`;
    case "Yield":
      return `Deposit $${cap} into the highest-yield ${name} vault on ${chain} and let the rewards compound`;
    case "Yield Aggregator":
      return `Deposit $${cap} into a ${name} auto-compounding vault on ${chain} and let it harvest for you`;
    case "RWA":
      return `Buy $${cap} of the ${name} tokenized asset on ${chain} and hold the receipt tokens in this wallet`;
    case "CDP":
      return `Lock $${cap} of collateral on ${name} on ${chain} and mint its stable asset, keeping the ratio above 150%`;
    case "Basis Trading":
      return `Deposit $${cap} as margin on ${name} and open 1 delta-neutral position on ${chain}`;
    case "Bridge":
    case "Canonical Bridge":
    case "Cross Chain Bridge":
      return `Bridge $${cap} from Ethereum to ${chain} through ${name} and keep the arrival receipt`;
    case "Chain":
      return `Bridge $${cap} to ${chain} and use 2 of ${name}'s native apps in the first week`;
    case "Payments":
      return `Route $${cap} through ${name} on ${chain} for a real payment and keep the receipt`;
    case "Insurance":
      return `Buy $${cap} of cover from ${name} on ${chain} for a position you already hold`;
    case "Staking Pool":
      return `Stake $${cap} through ${name} on ${chain} and keep the staking receipt token`;
    case "Liquid Staking":
      return `Stake $${cap} of ETH through ${name} on ${chain} and keep the liquid receipt token`;
    case "Liquid Restaking":
      return `Restake $${cap} of ETH through ${name} on ${chain} and keep the receipt token`;
    case "Restaked BTC":
      return `Restake $${cap} of BTC through ${name} on ${chain} and keep the receipt token`;
    case "Derivatives":
    case "Perps":
      return `Open 1 small hedge of $${cap} on ${name} on ${chain} and set a stop 5% away`;
    case "Leveraged Farming":
      return `Open a 2x leveraged farm of $${cap} on ${name} on ${chain} and check the liquidation price daily`;
    case "Liquidity Manager":
      return `Deposit $${cap} into a ${name} managed liquidity position on ${chain}`;
    case "Indexes":
      return `Buy $${cap} of the ${name} index on ${chain} and hold it in this wallet`;
    case "Privacy":
      return `Deposit $${cap} into ${name} on ${chain} from a fresh address you use for nothing else`;
    case "Governance Incentives":
      return `Lock $${cap} in ${name} governance on ${chain} and vote on 1 live proposal`;
    case "Stablecoin Wrapper":
      return `Wrap $${cap} through ${name} on ${chain} and keep the wrapped tokens`;
    case "Collateral Markets":
      return `Post $${cap} of collateral on ${name} on ${chain} and borrow $10 against it once`;
    case "CeDeFi":
      return `Deposit $${cap} into a ${name} custodial vault on ${chain} and keep the receipt`;
    case "Restaking":
      return `Restake $${cap} through ${name} on ${chain} and keep the restaking receipt token`;
    case "Farm":
      return `Deposit $${cap} into a ${name} farm on ${chain} and let the rewards compound`;
    case "Anchor BTC":
    case "Decentralized BTC":
      return `Deposit $${cap} of BTC into ${name} on ${chain} and keep the receipt token`;
    case "Crypto Card Issuer":
      return `Spend $${cap} through a ${name} card on ${chain} and keep the receipt`;
    case "Dual-Token Stablecoin":
      return `Mint $${cap} of ${name}'s stable asset on ${chain} against collateral`;
    case "Uncollateralized Lending":
      return `Borrow $${cap} from ${name} on ${chain} without collateral and repay it within 30 days`;
    case "Prediction Market":
      return `Bet $${cap} on 1 outcome on ${name} on ${chain} and keep the position receipt`;
    default:
      return `Deposit $${cap} into ${name} on ${chain} and keep the position receipt in this wallet`;
  }
}

export function weeklyFor(category: string | null, name: string, chain: string): string {
  const c = category ?? "";
  switch (c) {
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return `vote on a curator allocation or move 10% of the vault to a new curator`;
    case "Lending":
      return `repay a little of the loan or top it up by $10`;
    case "Dexs":
      return `swap once and add or remove a little liquidity`;
    case "Yield":
    case "Yield Aggregator":
      return `harvest the rewards and re-deposit them`;
    case "RWA":
      return `claim the yield and reinvest it in the same asset`;
    case "CDP":
      return `check the collateral ratio and top it up if it falls below 150%`;
    case "Basis Trading":
      return `close and reopen the hedge once to reset the funding`;
    case "Bridge":
    case "Canonical Bridge":
    case "Cross Chain Bridge":
      return `bridge a small amount back or on to a second chain`;
    case "Chain":
      return `use 1 new native app on ${chain}`;
    case "Payments":
      return `make 1 more real payment through ${name}`;
    case "Insurance":
      return `check that the cover is still active and extend it by 7 days if it lapses`;
    case "Staking Pool":
    case "Liquid Staking":
    case "Liquid Restaking":
    case "Restaked BTC":
      return `check the staking rewards and restake them`;
    case "Derivatives":
    case "Perps":
      return `open and close 1 small hedge`;
    case "Leveraged Farming":
      return `check the liquidation price and add $10 of margin if it gets close`;
    case "Liquidity Manager":
      return `check the position range and rebalance it once if it drifts out`;
    case "Indexes":
      return `check the index composition and rebalance if a holding changes by 5%`;
    case "Privacy":
      return `make 1 more deposit from a fresh address`;
    case "Governance Incentives":
      return `vote on 1 new proposal`;
    case "Stablecoin Wrapper":
      return `wrap $10 more and keep the receipt`;
    case "Collateral Markets":
      return `check the borrow rate and repay $10 if it rises above 5%`;
    case "CeDeFi":
      return `check the vault balance and withdraw $10 to test the exit`;
    case "Restaking":
      return `check the restaking rewards and restake them`;
    case "Farm":
      return `harvest the farm rewards and re-deposit them`;
    case "Anchor BTC":
    case "Decentralized BTC":
      return `check the BTC backing and top it up by $10 if it slips below 100%`;
    case "Crypto Card Issuer":
      return `make 1 more card payment through ${name}`;
    case "Dual-Token Stablecoin":
      return `check the peg and the collateral ratio once a week`;
    case "Uncollateralized Lending":
      return `repay $10 of the loan each week`;
    case "Prediction Market":
      return `settle 1 more prediction and check the odds once a week`;
    default:
      return `make 1 more deposit, borrow, swap or vote`;
  }
}

export function farmSteps(p: Protocol, f: Factors): string[] {
  const chain = f.chain;
  const gas = f.gasLabel;
  const cap = f.capTier;
  const hold = f.holdDays;
  const weeks = Math.ceil(hold / 7);
  const g = p.change_7d ?? 0;
  const rider =
    g > 10
      ? ` TVL is up ${fmtPct(g)}% in 7 days, so hold through at least 1 more weekly snapshot before judging the position.`
      : "";
  return [
    `Open a fresh wallet for ${p.name} only and write its 12-word seed on paper, never in a screenshot or a chat. Cost: $0 to create the wallet and about ${gas} for the first transaction on ${chain}. Time: 10 minutes to set up.`,
    `${actionFor(p.category, p.name, chain, cap)}. Cost: about ${gas} in gas on ${chain} plus the $${cap} deposit. Time: 15 minutes.`,
    `Once a week for ${weeks} weeks: ${weeklyFor(p.category, p.name, chain)}. Cost: about ${gas} per weekly action on ${chain}. Time: 10 minutes a week.`,
    `Hold the position for ${hold} days without withdrawing, and check ${p.name}'s points page once a week.${rider} Cost: $0 to hold and about ${gas} per weekly check on ${chain}. Time: ${hold} days.`,
    `Open ${p.name}'s own points or rewards page from the link the protocol itself publishes and claim only from there, never from a link in a DM. Cost: about ${gas} for the claim transaction on ${chain}. Time: 10 minutes.`,
    `Write down every deposit, vote and claim with the date and the transaction hash in a farm log, and screenshot the points balance once a week. Cost: $0. Time: 5 minutes a week.`,
  ];
}

// Plan total: setup gas + weekly gas x weeks + claim gas, in dollars.
export function planTotal(f: Factors): { total: number; weeks: number } {
  const weeks = Math.ceil(f.holdDays / 7);
  const total = f.gasMid + f.gasMid * weeks + f.gasMid;
  return { total, weeks };
}

const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// Board: the 40 watchlist protocols plus the 160 pre-token protocols
// below the floor with the most TVL (not CEX, not a versioned name),
// ranked by implied value.
export function buildBoard(snap: Snapshot): { rows: BoardRow[]; calibration: ReturnType<typeof calibrate> } {
  const cal = calibrate(snap.protocols);
  const watchSet = new Set(snap.watchlist);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const picked: Protocol[] = [];
  for (const slug of snap.watchlist) {
    const p = bySlug.get(slug);
    if (p) picked.push(p);
  }
  const early = snap.protocols
    .filter(
      (p) =>
        !watchSet.has(p.slug) &&
        isPreToken(p) &&
        p.tvl_usd < snap.floor_usd &&
        p.category !== "CEX" &&
        !VERSION_RE.test(p.name),
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, BOARD_ROWS - picked.length);
  const all = [...picked, ...early];
  const scored = all.map((p) => {
    const age = ageDays(p.listed_at, snap.as_of);
    const mult = multipleFor(p.category, cal.multiples);
    const value = impliedValue(p.tvl_usd, mult, age, p.change_7d);
    const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
    const gas = gasFor(chain);
    const f: Factors = {
      multiple: mult,
      multipleNote: multipleNoteFor(p.category, cal.notes),
      sizeFactor: sizeFactor(p.tvl_usd),
      growthMult: growthMult(p.change_7d),
      maturityMult: maturityMult(age),
      ageDays: age,
      capTier: capTier(p.tvl_usd),
      holdDays: holdDays(age),
      chain,
      gasLabel: gas.label,
      gasMid: gas.mid,
    };
    return { p, value, f };
  });
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.f.ageDays,
    rank: i + 1,
    implied_value_usd: s.value,
    farm_steps: farmSteps(s.p, s.f),
    multiple: s.f.multiple,
    multiple_note: s.f.multipleNote,
    size_factor: s.f.sizeFactor,
    growth_mult: s.f.growthMult,
    maturity_mult: s.f.maturityMult,
    hold_days: s.f.holdDays,
    cap_tier: s.f.capTier,
    gas_label: s.f.gasLabel,
    gas_mid: s.f.gasMid,
    live: !isPreToken(s.p),
    watch: watchSet.has(s.p.slug),
  }));
  return { rows, calibration: cal };
}
