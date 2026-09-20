// 「跑一次 `drizzle-kit push`，并**复核它真的落地了**」的单一出口。
//
// 为什么必须有复核（而不是看退出码）：`drizzle-kit push` 在无 TTY 环境
// （CI、脚本、后台启动的 dev server）遇到交互提示时报
// `Interactive prompts require a TTY terminal` 然后 **exit 0**。旧形态是
// 把 `db.sqlite` 留成 0 字节（`no such table`），新形态更隐蔽 —— 表都在、
// 只是结构漂移时，它**原样不动**，而「表数 > 0」的复核完全看不出来
// （实测现场：`workflowTemplate` 留着历史版本删过的 `graph TEXT NOT NULL`，
// 新建工作流直接 `NOT NULL constraint failed`，所有自检都说「已就绪」）。
//
// 判据只能取它自己的 diff 结果：
//   · `No changes detected` —— 库与 schema 一致（本来就是 / 第一次已应用完）；
//   · `Changes applied`     —— 这一次应用了变更；
//   · 两者都没有            —— 没走到 diff 那一步（交互被挡 / 连不上库 /
//                             命令压根没起来），**不能当成功**。
// 另有一次「跑第二次必须说 No changes detected」的收敛确认：它补的是
// 「说了 applied 但没落地」这一档。
//
// 输出一律走 `pipe` 再转发，而不是 `inherit`：既让调用方能看到进度，又必须
// 拿到文本作判据 —— `inherit` 下 stdout 是空的，判据会静默失效（比不判更糟）。
import { runPnpmSync } from "./launcher-core/shell.mjs";

/** 「这次跑完之后，库结构与 schema 一致」的判据（见文件头）。
 *  @param {string} output drizzle-kit 的输出（stdout 与 stderr 拼在一起）
 *  @returns {boolean} */
export function pushSettled(output) {
  return /(No changes detected|Changes applied)/i.test(output);
}

/** 「库结构与 schema 已经一致、无需再改」的判据。
 *  @param {string} output 同上
 *  @returns {boolean} */
export function pushConverged(output) {
  return /No changes detected/i.test(output);
}

/** 交互提示被挡下时的原话（用于把「为什么没同步」讲成人话）。
 *  @param {string} output 同上
 *  @returns {boolean} */
export function pushBlockedByTty(output) {
  return /Interactive prompts require a TTY/i.test(output);
}

/**
 * 「自动应用了也不会丢数据」的语句白名单。
 *
 * 只有这几类：建表、建索引、**加**列。凡是删表 / 删列 / 改类型 / SQLite 的
 * 重建表（`CREATE TABLE __new_x` + `DROP TABLE x` + rename），drizzle 只会给
 * 出 `DROP` / `RENAME` 这些词，一条都不在白名单里 —— 于是被判成「需要人工确认」。
 *
 * 为什么用白名单而不是黑名单：判据的失败方向必须是「不自动应用」。drizzle
 * 换了输出格式、我们漏认了某类语句时，黑名单会把它当安全语句**直接执行**，
 * 白名单只会让用户多跑一次命令。
 */
const SAFE_STATEMENT =
  /^(ALTER TABLE `[^`]+` ADD|CREATE TABLE\b|CREATE (UNIQUE )?INDEX\b)/i;

/**
 * 「这一行看起来是一条 SQL」—— 只收这些行。
 *
 * 不加这条会把 drizzle 随后的**报错堆栈**一起收进来（无 TTY 被挡时 stderr 就
 * 接在后面），于是白名单永远判不过、连「加一列」都同步不了：判据本身没坏，
 * 但功能整个失效。漏认的代价仍然落在安全一侧 —— 语句形态变了就收不到，
 * `canAutoApply` 判 false，交人工。
 */
const SQL_LINE = /^(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|PRAGMA|RENAME)\b/i;

/**
 * 从 drizzle-kit 的输出里取出「它打算执行、但还没执行」的语句。
 *
 * 输入是**被交互挡下**的那一次输出（`strict: true` 下它先列出语句再问，
 * 无 TTY 时原地退出、库不动）—— 所以这一段恰好是一份 dry-run 结果。
 *
 * 只认「about to execute」之后、下一处状态行之前的非空行；多行语句或带编号
 * 前缀的形态都取不全，取不全时的结论是「不在白名单里」→ 交人工，安全方向。
 *
 * @param {string} output drizzle-kit 被挡下那一次的输出（含 stdout 与 stderr）
 * @returns {string[]} 待执行语句（认不出时为空数组）
 */
export function pendingStatements(output) {
  const lines = String(output).split("\n");
  const start = lines.findIndex((line) => /about to execute/i.test(line));
  if (start === -1) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    /* 状态行（`[✓] Changes applied` / `[i] No changes detected` /
     * 下一次 `Reading config`）是这段列表的结束标志；空行只是分隔。 */
    if (/^(\[|Reading config|Warning\b|No changes detected|Changes applied)/i.test(text)) {
      break;
    }
    if (SQL_LINE.test(text)) out.push(text);
  }
  return out;
}

/** 这批语句能不能自动应用（全在白名单里，且确实有一批）。
 *  @param {string[]} statements `pendingStatements` 的结果
 *  @returns {boolean} */
export function canAutoApply(statements) {
  return statements.length > 0 && statements.every((s) => SAFE_STATEMENT.test(s));
}

/** 白名单之外的语句（给人看的原因）。
 *  @param {string[]} statements 同上
 *  @returns {string[]} */
export function riskyStatements(statements) {
  return statements.filter((s) => !SAFE_STATEMENT.test(s));
}

/**
 * 跑一次 push 并复核收敛。
 *
 * @param {string} root 项目根（作为 drizzle-kit 的 cwd）
 * @param {{ databaseUrl?: string, force?: boolean, config?: string,
 *           verifyConvergence?: boolean, timeoutMs?: number,
 *           run?: typeof runPnpmSync,
 *           forward?: (chunk: string) => void }} [options]
 *   `force` 为 true 时带 `--force`（自动批准「会丢数据」的语句，`pnpm db:push`
 *   的口径）；启动链路的自动同步**必须**用 false —— 那种变更要由人决定。
 *   `config` 指到另一份 drizzle 配置（启动链路用 `drizzle.config.autosync.ts`：
 *   关掉 `strict` 才可能在没有 TTY 的情况下自动应用「加表 / 加列」这类安全变更，
 *   详见那份配置的说明）。
 * @returns {{ converged: boolean, alreadyCurrent: boolean, invocationFailed: boolean,
 *             blockedByTty: boolean, error: NodeJS.ErrnoException | null,
 *             firstOutput: string, finalOutput: string }}
 */
export function pushSchema(root, options = {}) {
  const {
    databaseUrl,
    force = false,
    config,
    verifyConvergence = true,
    timeoutMs = 600_000,
    run = runPnpmSync,
    forward = (chunk) => process.stdout.write(chunk),
  } = options;

  const args = ["exec", "drizzle-kit", "push"];
  if (force) args.push("--force");
  if (config) args.push(`--config=${config}`);
  const env =
    databaseUrl === undefined
      ? process.env
      : { ...process.env, DATABASE_URL: databaseUrl };

  const first = run(args, { cwd: root, env, stdio: "pipe", timeoutMs });
  const firstOutput = `${first.stdout}\n${first.stderr}`;
  forward(first.stdout);

  /* 命令压根没起来（PATH 上没有 pnpm）与「跑完但没落地」要分开报：前者
   * stderr 通常是空的，只报「没收敛」等于没说原因（ISSUE #576 的形态）。 */
  if (first.error) {
    return {
      converged: false,
      alreadyCurrent: false,
      invocationFailed: true,
      blockedByTty: false,
      error: first.error,
      firstOutput,
      finalOutput: firstOutput,
    };
  }

  /* 本来就没差异：不必再跑一次确认（省一轮 drizzle 启动，约 2-3 秒）。
   * 启动链路走的就是这一支 —— 指纹说「可能要同步」，diff 说「其实不用」。 */
  if (pushConverged(firstOutput)) {
    return {
      converged: true,
      alreadyCurrent: true,
      invocationFailed: false,
      blockedByTty: false,
      error: null,
      firstOutput,
      finalOutput: firstOutput,
    };
  }

  if (!pushSettled(firstOutput)) {
    /* 没走到 diff（交互被挡最常见）。再跑一次也只会得到同一句，直接定性。 */
    return {
      converged: false,
      alreadyCurrent: false,
      invocationFailed: false,
      blockedByTty: pushBlockedByTty(firstOutput),
      error: null,
      firstOutput,
      finalOutput: firstOutput,
    };
  }

  /* 说了 Changes applied 之后要验「真的落地了」（写锁 / 半途失败 / 同源库被
   * 另一个进程改回去）。默认再跑一次 diff 来看「现在一致了吗」；调用方也可以
   * 关掉它，改用自己的廉价复核（启动链路就是这么做的：比 push 前后的库结构
   * 摘要 —— 每次都再起一轮 drizzle 要十几秒，而它只覆盖「一点都没落地」）。 */
  if (!verifyConvergence) {
    return {
      converged: pushSettled(firstOutput),
      alreadyCurrent: false,
      invocationFailed: false,
      blockedByTty: false,
      error: null,
      firstOutput,
      finalOutput: firstOutput,
    };
  }

  const second = run(args, { cwd: root, env, stdio: "pipe", timeoutMs });
  const finalOutput = `${second.stdout}\n${second.stderr}`;
  forward(second.stdout);
  return {
    converged: pushConverged(finalOutput),
    alreadyCurrent: false,
    invocationFailed: Boolean(second.error),
    blockedByTty: pushBlockedByTty(finalOutput),
    error: second.error ?? null,
    firstOutput,
    finalOutput,
  };
}
