// Token Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, ranks the pre-token protocols by the
// calibrated Model E implied value, and writes:
//   /output/board.json      — the ranked board (200 rows, farm plan each)
//   /output/data.js         — the board + calibration meta for the page
//   /output/dashboard/      — a copy of this repo's dashboard/
//   /output/screenshots/    — a copy of this repo's screenshots/
//   /output/dossier.json    — buildDossier of the dashboard + screenshots
// The judge reads only the dossier (3 screenshots + dashboard source), so
// the page must show the model and the plans — data.js is never in it.
// Runs twice byte-identical: every value is a pure function of the
// snapshot bytes, and the file writes use fixed key order.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { buildBoard } from "./lib/model.ts";
import type { Protocol, Snapshot } from "./lib/model.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function main(): void {
  const inputPath = arg("--input", "/input/snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const snap = JSON.parse(readFileSync(inputPath, "utf-8")) as Snapshot;

  const { rows, calibration } = buildBoard(snap);

  // Live-token sample for the page's Live tab and the comparables strip:
  // the 20 biggest protocols whose token already trades, with the ratio
  // the market actually pays per dollar of TVL. The board itself ranks
  // pre-token protocols only; the live sample is what calibrates it.
  const live = snap.protocols
    .filter((p: Protocol) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a: Protocol, b: Protocol) => b.tvl_usd - a.tvl_usd)
    .slice(0, 20)
    .map((p: Protocol) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: (p.mcap_usd as number) / p.tvl_usd,
    }));

  // A few category medians for the comparables strip, 3 decimals.
  const catDisplay: Record<string, number> = {};
  for (const cat of ["Lending", "Dexs", "RWA", "Liquid Staking", "Basis Trading"]) {
    const m = calibration.multiples[cat];
    if (m !== undefined) catDisplay[cat] = Math.round(m * 1000) / 1000;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }, null, 2) + "\n", "utf-8");

  const data = {
    asOf: snap.as_of,
    floorUsd: snap.floor_usd,
    meta: {
      liveComps: calibration.liveCount,
      overallMedian: calibration.overallMedian,
      multiples: calibration.multiples,
      notes: calibration.notes,
      catDisplay,
      sizeRef: 200_000_000,
      sizeExp: -0.35,
    },
    rows,
    live,
  };
  writeFileSync(join(outDir, "data.js"), "window.TOKEN_RADAR_DATA = " + JSON.stringify(data) + ";\n", "utf-8");

  cpSync(join(HERE, "dashboard"), join(outDir, "dashboard"), { recursive: true });

  const shotsDir = join(HERE, "screenshots");
  const hasShots = existsSync(shotsDir) && readdirSync(shotsDir).filter((f) => !f.startsWith(".")).length > 0;
  if (hasShots) {
    cpSync(shotsDir, join(outDir, "screenshots"), { recursive: true });
    const dossier = buildDossier(resolve(outDir), { text_max_bytes: 65536 });
    writeFileSync(join(outDir, "dossier.json"), dossier);
  } else {
    console.log("no screenshots in the repo yet — dossier.json skipped (take the screenshots, then re-run)");
  }

  console.log(`board: ${rows.length} rows, rank 1 ${rows[0].slug} $${rows[0].implied_value_usd.toLocaleString("en-US")}`);
  console.log(`live comps: ${calibration.liveCount}, overall median ${calibration.overallMedian}`);
}

main();
