// ── 后台启动分支的结果记账（ISSUE #4257）────────────────────────────────
//
// instrumentation 的五个后台分支（dispatch / reaper / film-resume /
// event-loop-watch / sentry）失败时原先只有一行 boot 日志——功能**静默失效**：
// dispatch 挂了任务永久 QUEUED、reaper 挂了孤儿任务永不对账、film-resume 挂了
// 影片永停 GENERATING。这里收两件事：
//
//   · 结果记账（进程内注册表 + 落盘 run/boot-branches.json，重启后仍可查）；
//   · 供 `/api/dev/boot-branches` 读取的只读出口（消息中心据此提示）。
//
// 不带 `server-only`：instrumentation 的 nodejs 分支动态引它，`/api/dev/*`
// 路由静态引它——两边都在服务端，但本文件刻意保持零副作用（import 时不读盘）。

import { promises as fs } from "node:fs";
import path from "node:path";

import { isRecord } from "~/lib/is-record";

/** 影响功能的后台分支（观测类的 event-loop-watch / sentry 不在其中）。 */
export const FUNCTIONAL_BRANCHES: ReadonlySet<string> = new Set([
  "dispatch",
  "reaper",
  "film-resume",
]);

export type BootBranchOutcome = {
  at: string;
  detail: string;
  name: string;
  ok: boolean;
};

type BootBranchRegistry = {
  outcomes: Map<string, BootBranchOutcome>;
};

/** 跨 HMR 存活的注册表（与 runner-state 同一取向：`??=` 只认键名）。 */
function registry(): BootBranchRegistry {
  const holder = globalThis as typeof globalThis & {
    __comfyBootBranches_v1?: BootBranchRegistry;
  };
  return (holder.__comfyBootBranches_v1 ??= { outcomes: new Map() });
}

const RUN_DIR = path.join(process.cwd(), "run");
const BOOT_BRANCHES_FILE = path.join(RUN_DIR, "boot-branches.json");

function nowIso(): string {
  return new Date().toISOString();
}

/** 记一条分支结果并落盘（落盘失败不影响启动流程本身）。 */
export function recordBootBranch(name: string, ok: boolean, detail: string): BootBranchOutcome {
  const outcome: BootBranchOutcome = { name, ok, detail, at: nowIso() };
  registry().outcomes.set(name, outcome);
  void persistBootBranches().catch(() => undefined);
  return outcome;
}

/** 本进程记过的全部分支结果（时间序）。 */
export function bootBranchOutcomes(): BootBranchOutcome[] {
  return [...registry().outcomes.values()];
}

/** 仍处失败状态的功能分支（消息中心只提示这些）。 */
export function failedFunctionalBootBranches(): BootBranchOutcome[] {
  return bootBranchOutcomes().filter((o) => !o.ok && FUNCTIONAL_BRANCHES.has(o.name));
}

/** 落盘串行队列：分支失败可能接连发生，每次记账都会触发一次落盘——并发写
 *  同一文件在 Windows 上会互相踩（EPERM），而「慢的那次旧快照后到」会把
 *  新快照覆盖回旧内容（CI 上读回用例实测输过一次）。写入排成一条链：
 *  永远串行、后写覆盖先写，读回永远看到最新一次的完整快照。 */
let writeChain: Promise<void> = Promise.resolve();

/** 落盘（`run/boot-branches.json`，gitignore 的运行期目录）。返回的 promise 在
 *  **这一笔**写完（或失败）时结算；生产里是 fire-and-forget，测试要确定性
 *  就显式 await（它排在队列里，之前欠的写入也会一并完成）。 */
export function persistBootBranches(): Promise<void> {
  const next = writeChain.then(persistNow, persistNow);
  writeChain = next;
  return next;
}

async function persistNow(): Promise<void> {
  const payload = {
    generatedAt: nowIso(),
    branches: bootBranchOutcomes(),
  };
  await fs.mkdir(RUN_DIR, { recursive: true });
  await fs.writeFile(BOOT_BRANCHES_FILE, JSON.stringify(payload, null, 2), "utf8");
}

/** 读取落盘的分支结果；文件不存在 / 坏了 = 还没记过或不可读，返回空。 */
export async function readPersistedBootBranches(): Promise<BootBranchOutcome[]> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(BOOT_BRANCHES_FILE, "utf8"));
    const record = isRecord(raw) ? raw : {};
    const list: unknown[] = Array.isArray(record.branches) ? record.branches : [];
    return list.filter(isOutcome);
  } catch {
    return [];
  }
}

function isOutcome(value: unknown): value is BootBranchOutcome {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.at === "string" &&
    typeof value.detail === "string" &&
    typeof value.name === "string" &&
    typeof value.ok === "boolean"
  );
}
