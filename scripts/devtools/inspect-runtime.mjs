/**
 * inspect-runtime.mjs —— 运行时进程 / 端口 / 探活的**只读清单**（ISSUE #5169）。
 *
 * 手敲 `Get-NetTCPConnection` / `Get-CimInstance` / `netstat -ano` 判不出归属
 * （隔壁检出占同一个端口），按进程名泛匹配又容易误杀。这里全部复用现成判据：
 * `resolveAppPort` + `scanPorts`（含 +1/+2 顺延位）、`listeningPidsOnPort` /
 * `processCommandLines`（归属）、`classifyProbe`（四态）。foreign 只列不碰；
 * 探测失败落「没量到」，绝不落「空闲」。
 *
 * 用法：`pnpm inspect:runtime [--json]`
 * 退出码：0 = 量到了（无论忙闲）；2 = 探测没跑起来（没量到）/ 用法错。
 */
import { pathToFileURL } from "node:url";

import { resolveAppPort } from "../app-port.mjs";
import { runningAppInstances, scanPorts } from "../launcher-core/port-reap.mjs";
import { classifyProbe, describeProbeState } from "../launcher-core/orchestrator.mjs";
import { listeningPidsOnPort, processCommandLines } from "../launcher-core/procs.mjs";

const ROOT = process.cwd();

/**
 * 把一批 PID 的命令行折成归属。纯函数，便于用例喂形状。
 *
 * @param {Map<number,string>} lines
 * @param {number[]} ownPids
 * @param {number[]} sessionPids
 */
export function ownershipOf(lines, ownPids, sessionPids) {
  const own = new Set(ownPids);
  const session = new Set(sessionPids);
  return [...lines.entries()].map(([pid, cmdline]) => ({
    pid,
    owner: own.has(pid) ? "own" : session.has(pid) ? "session" : "foreign",
    cmdline: String(cmdline ?? "").slice(0, 200),
  }));
}

/**
 * 一个端口的只读读数。探测失败一律落「没量到」，不落「空闲」。
 *
 * @param {number} p
 * @param {number[]} ownPids
 * @param {number[]} sessionPids
 */
async function inspectPort(p, ownPids, sessionPids) {
  /** @type {number[]} */
  let pids;
  try {
    pids = await listeningPidsOnPort(p);
  } catch {
    return { port: p, listening: "没量到", owners: [], probe: "没量到" };
  }
  /** @type {Map<number,string>} */
  let lines = new Map();
  if (pids.length > 0) {
    try {
      lines = await processCommandLines(pids);
    } catch {
      return { port: p, listening: pids, owners: [], probe: "没量到", note: "命令行没量到" };
    }
  }
  let probe = "没量到";
  try {
    probe = describeProbeState(await classifyProbe({ port: p }));
  } catch {
    /* 探测没跑起来 ⇒ 保留「没量到」，不冒充空闲。 */
  }
  return {
    port: p,
    listening: pids,
    owners: ownershipOf(lines, ownPids, sessionPids),
    probe,
  };
}

/**
 * @param {{json?:boolean, log?:(s:string)=>void}} ctx
 */
export async function inspectRuntime({
  json = false,
  log = (s) => process.stdout.write(`${s}\n`),
} = {}) {
  const port = resolveAppPort(ROOT);
  const ports = scanPorts(port);
  /** @type {{running:boolean, pids:number[], via:"port"|"session"|null}} */
  let own;
  try {
    own = await runningAppInstances(ROOT);
  } catch {
    log("[inspect:runtime] 本检出实例探测没跑起来 ⇒ 落「没量到」，不落「无实例」。");
    return 2;
  }
  const sessionPids = own.via === "session" ? own.pids : [];
  const rows = await Promise.all(ports.map((p) => inspectPort(p, own.pids, sessionPids)));
  if (json) {
    log(JSON.stringify({ root: ROOT, resolvedPort: port, instances: own, rows }, null, 2));
    return 0;
  }
  const instanceText = own.running ? `在跑（${own.via}，PID ${own.pids.join(",")}）` : "未发现";
  log(`[inspect:runtime] 本检出解析端口 ${port}（含顺延位 +1/+2） · 实例 ${instanceText}`);
  for (const r of rows) {
    const listening = Array.isArray(r.listening) ? r.listening.join(",") || "空闲" : r.listening;
    log(`  端口 ${r.port} · 监听 ${listening} · 探活 ${r.probe}`);
    for (const o of r.owners) {
      log(`    PID ${o.pid} · ${o.owner} · ${o.cmdline}`);
    }
  }
  return rows.every((r) => r.probe === "没量到") ? 2 : 0;
}

/** @param {string[]} argv */
async function main(argv) {
  const bad = argv.filter((a) => a !== "--json");
  if (bad.length > 0) {
    process.stderr.write("用法：pnpm inspect:runtime [--json]\n  只读，不回收任何进程。\n");
    return 2;
  }
  return inspectRuntime({ json: argv.includes("--json") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
