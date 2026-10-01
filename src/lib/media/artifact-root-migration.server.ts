/* 一次性把历史产物根 `<cwd>/public/generated` 搬到现在的 `<cwd>/generated`。
 *
 * 为什么要有这一份（台账 A13 的结构性关法）：产物根曾经住在 `public/` 下，而
 * `public/**` 由 Next **按静态文件直接发出**，不经过任何 route handler ——
 * 会话与归属判定写在 handler 里时，同一个文件把 URL 中的 `api/` 去掉就能整条绕过
 * （实测：静态形状 200 原图、带闸形状 401）。当时的唯一补法是 `src/proxy.ts` 把
 * `/generated/**` rewrite 进 `/api/generated/**`，而那条依赖 `config.matcher`
 * 把每个带扩展名的形状列全，漏一个就是「一行代码不动、判据零执行、零报错」。
 * 根搬出去之后这条静态通道**不存在**，判据只剩 route 一处。
 *
 * 三条硬约束：
 *  1. **绝不覆盖、绝不删数据**：目标格里已有同名条目就跳过并记下来，历史行留在原地。
 *     这一条优先于「搬干净」。
 *  2. **不抛**：搬不动（Windows 上文件被别的进程占用 → EPERM）返回报告给调用点，
 *     由调用点落面板日志（硬规则 4：失败路径必须有日志 + 用户可见出口）。
 *     这里不静默、也不硬 fail —— 产物搬不动不该让应用起不来。
 *  3. **幂等**：第二次调用时 legacy 已不存在 ⇒ `nothing-to-do`。两个进程同时起时
 *     某一个会拿到 ENOENT（= 对方已经搬走了），按「已搬走」记账而不是按失败记账。
 *
 * 地址前缀不在这里动：库里存的是 `/api/generated/…`（`ARTIFACT_URL_PREFIX`），
 * 与磁盘根是两件事，所以搬根之后历史行照常读得到。
 */
import "server-only";

import fs from "node:fs";
import path from "node:path";

import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";
import { generatedRoot, legacyGeneratedRoot } from "./output-paths";

const log = createAppRuntimeLogger("artifact-root");

/** 一次迁移的结果形状（调用点据此决定说什么话）。 */
export interface ArtifactRootMigrationReport {
  status: "nothing-to-do" | "moved" | "left-behind";
  /** 成功搬到新根的顶层条目名。 */
  moved: string[];
  /** 新根里已有同名条目 ⇒ 原样留在原地，绝不覆盖。 */
  skipped: string[];
  /** 没能搬走的条目（被占用 / 权限），名字与 errno 码成对。 */
  blocked: { name: string; code: string }[];
}

/** 把一个顶层条目从旧根挪到新根。ENOENT 视为「别的进程已经搬走了」，不算失败。 */
function moveEntry(
  from: string,
  to: string,
):
  | { kind: "moved" }
  | { kind: "already-gone" }
  | { kind: "blocked"; code: string } {
  try {
    fs.renameSync(from, to);
    return { kind: "moved" };
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String(e.code)
        : "UNKNOWN";
    // 两个宿主同时起（Next 与执行器宿主）时这条会撞上：先动的那个已经把名字搬走了
    return code === "ENOENT"
      ? { kind: "already-gone" }
      : { kind: "blocked", code };
  }
}

/**
 * 执行一次搬迁。不抛，返回报告；报告为空转（`nothing-to-do`）时什么都不做，
 * 连新根都不会创建（首启目录由写侧的 `mkdir(recursive)` 负责）。
 */
export function migrateLegacyArtifactRoot(
  cwd: string = process.cwd(),
): ArtifactRootMigrationReport {
  const legacy = legacyGeneratedRoot(cwd);
  const target = generatedRoot(cwd);
  const report: ArtifactRootMigrationReport = {
    status: "nothing-to-do",
    moved: [],
    skipped: [],
    blocked: [],
  };

  let entries: string[];
  try {
    if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory())
      return report;
    entries = fs.readdirSync(legacy);
  } catch {
    // 读不到旧根（权限 / 正被删）：记成「留在原地」，让调用点有话可说，不阻断启动
    return { ...report, status: "left-behind" };
  }
  if (entries.length > 0) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of entries) {
      const to = path.join(target, name);
      if (fs.existsSync(to)) {
        // 同名 = 新根那边已经有这一格（升级期间写过同一个任务 id？理论上撞不上，
        // 撞上了也不该猜哪份是对的）：留在原地，绝不覆盖。
        report.skipped.push(name);
        continue;
      }
      const outcome = moveEntry(path.join(legacy, name), to);
      if (outcome.kind === "moved") report.moved.push(name);
      else if (outcome.kind === "blocked")
        report.blocked.push({ name, code: outcome.code });
    }
  }
  // 只有「一条都没留下」才试着收掉空壳；留着旧目录不是错误，而是下面这句话的
  // 依据：那些文件还在原来的地方，面板会说清楚。
  if (
    report.skipped.length === 0 &&
    report.blocked.length === 0 &&
    fs.readdirSync(legacy).length === 0
  ) {
    try {
      fs.rmdirSync(legacy);
    } catch {
      // 空目录删不掉（句柄未释放）：不影响可读性，下一次启动再收
    }
  }
  if (
    report.moved.length > 0 ||
    report.skipped.length > 0 ||
    report.blocked.length > 0
  ) {
    report.status =
      report.skipped.length > 0 || report.blocked.length > 0
        ? "left-behind"
        : "moved";
  }

  // 面板可见日志：只在「真的动过盘」或「动不干净」时写，空转不刷屏
  if (report.status === "moved") {
    log.info(
      `产物目录已从 public/generated 搬到 generated（${report.moved.length} 项）`,
    );
  } else if (report.status === "left-behind") {
    log.error(
      `产物目录搬迁未全部完成：搬走 ${report.moved.length} 项，` +
        `留在 public/generated 的是 ${
          [
            ...report.blocked.map((b) => `${b.name}(${b.code})`),
            ...report.skipped.map((s) => `${s}(新根已有同名)`),
          ].join("、") || "（旧根读不到）"
        }`,
    );
  }
  return report;
}
