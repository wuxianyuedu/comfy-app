/**
 * localWorkflows.ts —— 用户配置的工作流目录（LOCAL_WORKFLOWS_PATH）的**只读**扫描器。
 *
 * 配置的根目录由 `scanLocalWorkflowRoots` 读取（逐路径扫描；默认**不**递归到根目录之外
 * —— recursive=false 是最安全的行为，只有用户明确要求遍历子目录时才传
 * {recursive:true}）。返回的每一项都是一个**文件**（`.json` / `.workflow`），
 * 带绝对路径 + 大小 + mtime，让 UI 能像自定义节点清单那样识别出
 * 「已加载但已过期」的形态。
 *
 * **铁律：这些根目录永远不会被写入。** 只允许
 * `fs.readdirSync` / `fs.statSync` / `fs.createReadStream`；禁止
 * `fs.writeFile`、`fs.rename`、`fs.rm`、`unlink`、`appendFile` 等 ——
 * 违反者必须在 Code Review 拦下。
 *
 * `scanLocalWorkflowChecksums` 返回一份 `{absPath, checksum}` 清单，
 * 供路由层的「改名后重新挂接」流程使用。checksum 与
 * `importSource.checksum()` 写进 `WorkflowTemplate.sourceChecksum` 的是同一种
 * SHA-1（UTF-8 文件内容的前 16 位十六进制），因此即便原来的 `sourcePath`
 * 已经不存在，改过名的文件也能**按内容**重新匹配上。
 */
import "server-only";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export interface LocalWorkflowFile {
  /** 绝对、归一化后的文件系统路径（小写 + 正斜杠，便于 Windows 盘符比较）。 */
  absPath: string;
  /** 仅文件名（在待处理卡片上用作友好的默认值）。 */
  name: string;
  /** 扫描器看到的**原始**路径字符串（保留下来，让 UI 显示的就是用户当初输入的
   *  内容，而不是重新解析后的版本）。 */
  rawPath: string;
  size: number;
  mtimeMs: number;
  /** 这个文件来自哪个配置好的 LOCAL_WORKFLOWS_PATH 根目录。
   *  API 层据此给每一行盖上 `sourceRoot`，客户端才能按前缀匹配。
   *  值等于该根目录的 `rawPath`（逐字，与用户在对话框里输入的一致）。 */
  rootRawPath: string;
  /** 解析后的绝对根路径（输入本身就是绝对路径时等于 `rawPath`；
   *  相对路径按 CWD 解析）。API 层用它对各工作流的 `sourcePath`
   *  做**忽略大小写**的前缀检查。 */
  rootAbsPath: string;
}

export interface ScannedRoot {
  /** 配置的根目录（逐字），用于显示。 */
  rawPath: string;
  /** 归一化后的绝对路径；用户本来就输入绝对路径时等于 `rawPath`。
   *  用于 Windows 上忽略大小写的比较。 */
  absPath: string;
  exists: boolean;
  /** 逐文件的扫描结果。根目录不存在、或里面没有 `.json` / `.workflow` 时为空。
   *  **从不**抛错 —— 扫描失败经 `error`（可选字符串）上报。 */
  files: LocalWorkflowFile[];
  error?: string;
}

/** 与服务端其余部分用同一种方式归一化绝对路径：反斜杠 → 正斜杠、转小写。
 *  与 customNodes.ts 的 `pathKey` 同口径，Windows 盘符大小写因此不会对不上。 */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return path.resolve(p).toLowerCase().replace(/\\/g, "/");
  } catch {
    return p.toLowerCase().replace(/\\/g, "/");
  }
}

/** 解析成绝对路径，同时保留原始写法供 UI 渲染（显示时保留大小写）。 */
function resolve(p: string): string {
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

/** 读一个目录，过滤出 `.json` / `.workflow`（忽略大小写），按名字排序。
 *  **从不**抛错 —— 目录缺失 / 不可读时返回 `{exists:false, files:[]}`
 *  （权限错误则带 `error` 文案）。`recursive` 默认为 false（只扫一层）：
 *  ComfyUI 自己的 `workflows/` 目录用 `default/`、`image/` 这类子目录分层，
 *  而我们**确实想**跟着进去 —— 用户给一个根目录，意思通常是
 *  「把我 workflows/ 里的东西都加载进来」。需要时用第二个参数打开递归。 */
function scanRoot(rawDir: string, recursive: boolean): ScannedRoot {
  const abs = resolve(rawDir);
  // 闭包里的「这个文件来自根目录 X」标记 —— 每推入一项就盖上，
  // by `visit` so callers can show "📂 <root 短名>" without re-computing
  // 让调用方能在自己那边做前缀匹配。
  const stampRoot = () => ({ rootRawPath: rawDir, rootAbsPath: abs });
  if (!fs.existsSync(/*turbopackIgnore: true*/ abs)) {
    return { rawPath: rawDir, absPath: abs, exists: false, files: [] };
  }
  try {
    const stat = fs.statSync(/*turbopackIgnore: true*/ abs);
    if (!stat.isDirectory()) {
      return {
        rawPath: rawDir,
        absPath: abs,
        exists: true,
        files: [],
        error: "配置的路径不是目录（指向的是一个文件）",
      };
    }
  } catch (e) {
    // e 为 unknown：`(e as Error)?.message ?? String(e)` 与旧 `e?.message ?? String(e)`
    // 的运行时语义逐字一致（node fs 抛的都是 Error 实例）。
    const msg = (e as Error | undefined)?.message ?? String(e);
    return {
      rawPath: rawDir,
      absPath: abs,
      exists: false,
      files: [],
      error: `无法访问：${msg}`,
    };
  }

  const out: LocalWorkflowFile[] = [];
  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      out.push({
        absPath: "",
        name: `(无法读取 ${dir})`,
        rawPath: dir,
        size: 0,
        mtimeMs: 0,
        ...stampRoot(),
      });
      // 兜底：读目录出错就跳过它，继续处理兄弟目录
      // （非递归时本来也没别的事；递归时由调用方决定）。
      return;
    }
    for (const ent of entries) {
      const fullPath = path.join(dir, ent);

      let st;

      try {
        st = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        if (recursive) visit(fullPath);

        continue;
      }

      if (!st.isFile()) continue;

      if (!/\.(json|workflow)$/i.test(ent)) continue;

      out.push({
        absPath: path.resolve(fullPath),

        name: ent,

        rawPath: fullPath,

        size: st.size,

        mtimeMs: st.mtimeMs,

        ...stampRoot(),
      });
    }
  };
  try {
    visit(abs);
  } catch (e) {
    const msg = (e as Error | undefined)?.message ?? String(e);
    return {
      rawPath: rawDir,
      absPath: abs,
      exists: true,
      files: out,
      error: `扫描失败：${msg}`,
    };
  }

  out.sort((left, right) => left.name.localeCompare(right.name));
  return { rawPath: rawDir, absPath: abs, exists: true, files: out };
}

/** 扫描所有配置的根目录，产出：
 *  • 逐根目录的明细（UI 用来显示统计 / 缺失目录 / 错误）；
 *  • 跨所有根目录的 `LocalWorkflowFile` 扁平清单，按绝对路径去重
 *    （用户可以把互相重叠的根目录都列上而不产生重复项）。 */
export function scanLocalWorkflowRoots(
  rawPaths: string[],
  opts: { recursive?: boolean } = {},
): { roots: ScannedRoot[]; allFiles: LocalWorkflowFile[] } {
  const recursive = !!opts.recursive;
  const seen = new Set<string>();
  const allFiles: LocalWorkflowFile[] = [];
  const roots: ScannedRoot[] = [];
  for (const p of rawPaths) {
    const trimmed = p.trim();

    if (!trimmed) continue;

    const r = scanRoot(trimmed, recursive);

    roots.push(r);

    for (const file of r.files) {
      if (!file.absPath) continue;

      const key = pathKey(file.absPath);

      if (seen.has(key)) continue;

      seen.add(key);

      allFiles.push(file);
    }
  }

  return { roots, allFiles };
}

/* ─────────────────────────────────────────────────────────────────────────
 * 改名后仍能重新挂接的支持。
 *
 * 目标：用户在磁盘上给某个本地工作流 JSON 改了名，而 DB 的
 * `WorkflowTemplate.sourcePath` 里还存着**旧的**绝对路径。此时一次常规的
 * /api/workflows GET 会把该行标成 `diskMissing=true`，
 * 工作流库便拒绝再操作这一行。
 *
 * 修法走**按内容寻址**：`importSource.checksum(text)` 把文件 UTF-8 内容的
 * SHA-1 前 16 位十六进制写进 `WorkflowTemplate.sourceChecksum`。
 * 改名之后**内容**一模一样，checksum 自然还是同一个。
 * 我们扫描所有配置好的 LOCAL_WORKFLOWS_PATH 根目录、为每个文件算同一个
 * checksum，让路由层把一个「找不到」的工作流重新匹配回它的新位置。
 *
 * 实现选择：**流式** SHA-1（`createReadStream` + 管道进 `Hash`），
 * 几 MB 的工作流也不会把堆撑爆。读不了的文件（权限错误、扫描中途消失）
 * 静默跳过 —— 这条改名流程本来就是尽力而为。
 *
 * **同一份内容只读一遍**：`workflow.list` 每次轮询都会走到这里，而文件在两次
 * 轮询之间通常没变。按「路径 + mtime + size」记忆上一趟的 checksum（见
 * `checksumCache`），命中时连文件都不打开 —— 这曾是本接口稳定 1s+ 的主因。
 * ───────────────────────────────────────────────────────────────────────── */

export interface LocalChecksumEntry {
  /** 磁盘文件的绝对路径。 */
  absPath: string;
  /** sha1(text).slice(0,16) —— 与 `WorkflowTemplate.sourceChecksum` 同值。 */
  checksum: string;
  /** 文件 mtime（毫秒时间戳，取自扫描器的 `statSync`）。调用方在多个文件
   *  checksum 相同时用它断开（少见但确实可能）；它同时是 checksum 记忆的键。 */
  mtimeMs: number;
}

/** checksum 的 mtime+size 记忆表。
 *
 *  为什么必须有：`scanLocalWorkflowChecksums` 是**每一趟 `workflow.list` 都跑**的
 *  一步，而它把这个根目录下每个 `.json` / `.workflow` 完整读一遍再算 SHA-1。
 *  工作流 JSON 动辄几 MB，几十个文件（并发 8）就是稳定 1s+ 的纯重复劳动——
 *  文件在两次轮询之间根本没变，却被重算了整份内容。
 *
 *  **判据是「路径 + mtimeMs + size 三元组完全一致」**：三者任一不同就重算。
 *  这是文件系统能给出的最强「内容没变」证据（`mtime` 精度足够，且写入会同时
 *  改 `size` 或 `mtime`）；同秒内的「改完又改回来」会让 checksum 走一次旧的，
 *  但那个旧值**本来就是当前内容的值**，不影响正确性。
 *
 *  挂在 `globalThis`（项目里 lifecycle / executor-cli 等同款口径）：Turbopack
 *  热重载会重新求值本模块，模块级 `Map` 每次都被清空，记忆就白做了。
 *  容量有上限：文件被删 / 改名后旧键会留在表里，不设界就是慢性泄漏。 */
const CHECKSUM_CACHE_KEY = "__localWorkflowChecksums_v1";
const CHECKSUM_CACHE_MAX = 512;

type ChecksumMemo = { mtimeMs: number; size: number; checksum: string };

function checksumCache(): Map<string, ChecksumMemo> {
  const g = globalThis as unknown as Record<
    string,
    Map<string, ChecksumMemo> | undefined
  >;
  g[CHECKSUM_CACHE_KEY] ??= new Map();
  return g[CHECKSUM_CACHE_KEY];
}

/** checksum 记忆的容量淘汰：超出上限时丢掉最早插入的键（Map 的插入序）。
 *  不做 LRU（读一遍不重排）——命中率只取决于「同一批文件反复扫」，这已经够了。 */
function rememberChecksum(key: string, memo: ChecksumMemo): void {
  const cache = checksumCache();
  cache.delete(key);
  cache.set(key, memo);
  while (cache.size > CHECKSUM_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 流式读内容算出单个文件的 checksum。
 *  任何读错误（权限、文件消失等）都 resolve 成 `null`，
 *  调用方可以跳过它而不必中断整趟扫描。
 *
 *  `size` / `mtimeMs` 由调用方从**同一趟扫描**的 `statSync` 结果传入：扫描器刚
 *  拿过它们，再 `statSync` 一次既多余、也可能与刚才那一次不一致（文件正好在
 *  两次之间被写）。三元组一致即直接复用记忆值，**连文件都不打开**。 */
function checksumOfFile(
  absPath: string,
  size: number,
  mtimeMs: number,
): Promise<{ checksum: string; mtimeMs: number } | null> {
  const key = pathKey(absPath);
  const cached = checksumCache().get(key);
  if (cached?.mtimeMs === mtimeMs && cached.size === size) {
    return Promise.resolve({ checksum: cached.checksum, mtimeMs });
  }
  return new Promise((resolve) => {
    try {
      const hash = createHash("sha1");
      const stream = fs.createReadStream(absPath, { encoding: "utf8" });
      stream.on("data", (chunk) => hash.update(chunk as string));
      stream.on("error", () => resolve(null));
      stream.on("end", () => {
        const checksum = hash.digest("hex").slice(0, 16);
        rememberChecksum(key, { mtimeMs, size, checksum });
        resolve({ checksum, mtimeMs });
      });
    } catch {
      resolve(null);
    }
  });
}

/** 丢掉 checksum 记忆：本地工作流文件的 checksum 落库口径变了、或需要强制
 *  重新读盘时调用（测试与排障用，正常路径靠 mtime+size 自动失效）。 */
export function resetLocalWorkflowChecksumCache(): void {
  checksumCache().clear();
}
/** 扫描每个配置的根目录，为每个可读的 `.json` / `.workflow` 文件返回
 *  `{absPath, checksum, mtimeMs}`。没有配置任何根目录（或每趟扫描都失败）时
 *  resolve 成空数组。单个文件的访问错误会被吞掉（尽力而为）。
 *
 *  mtime+size 与上一趟相同的文件直接取记忆里的 checksum，不再读内容 ——
 *  这是「轮询里同一份数据反复出现」的常规场景（见 `checksumCache`）。 */
export async function scanLocalWorkflowChecksums(
  rawPaths: string[],
): Promise<LocalChecksumEntry[]> {
  const { allFiles } = scanLocalWorkflowRoots(rawPaths);
  const out: LocalChecksumEntry[] = [];
  // 并发上限：一次扫 200 个文件不会同时开 200 条流。
  const MAX_PARALLEL = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < allFiles.length) {
      const i = cursor++;

      const file = allFiles[i]!;

      if (!file.absPath) continue;

      const result = await checksumOfFile(
        file.absPath,
        file.size,
        file.mtimeMs,
      );

      if (result) {
        out.push({
          absPath: file.absPath,
          checksum: result.checksum,
          mtimeMs: result.mtimeMs,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL, allFiles.length) }, () =>
      worker(),
    ),
  );
  return out;
}
