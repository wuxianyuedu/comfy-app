import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { apiErrorBody } from "~/lib/api-error";
import { clamp } from "~/lib/clamp";
import { LOG_ROOT, RUNTIME_LOG_FILES } from "~/lib/log/log-paths";
import type { LogSessionsPayload } from "~/lib/log/log-sessions";
import {
  buildRunOptions,
  formatRunLabel,
  packNameOf,
  runSlice,
  type RunPack,
  type RuntimeLogRunOption,
} from "~/lib/log/log-run-sessions";
import {
  runPackBaselineSize,
  scanRunPacks,
} from "~/lib/log/log-run-packs.server";
import {
  LOG_LAYOUT,
  currentDir,
  readRunJsonAt,
  runsDir,
} from "../../../../../scripts/launcher-core/run.mjs";

/**
 * `GET /api/logs/sessions` —— 按「每一次运行」列出启动日志，并回指定一次的正文。
 *
 * 供设置页「启动日志」小窗口与它的全屏视图：那里要的是「切到某一次运行」。
 *
 * ## ISSUE #1326：这一层是**跨运行**的（与「一次运行一包」对齐）
 *
 * 此前只按**文件内**的会话横幅切分（`log-sessions.ts`）—— 那套的可见性止于
 * 应用退出：进程退出时 `current/` 被复制进 `log/runs/<日期>_<时分秒>-<runId>/`
 * 再清空，下一次启动文件从空开始，`runs/` 里那一包**没有界面能打开**（用户原话：
 * 「之前能切换的也是历史，不能用 runs 中找吗」）。现在列表 = 本次运行
 * （`current/`）＋ `runs/` 里各历史包（新→旧），正文取**那一包**里该来源的文件。
 *
 * ## 两处判据都在 `log-run-sessions.ts` 里（这里只做 IO）
 *
 *   1. **正文要减去前一包**：那几份 runtime 日志追加不轮转，而归档是「整目录
 *      复制」，因此包 N 的文件 ⊇ 包 N-1。不减的话点开「上一次」看到的是从装
 *      应用那天起的全部输出；
 *   2. **基准不可得时整份给出并说出来**（响应的 `baselineMissing`）：保留策略
 *      会删包，这时猜一个基准去切会把真实内容切掉，比多显示糟得多。
 *
 * ## 路径从哪来（§12.14 收口）
 *
 * `current/` 与 `runs/` 的形态**只有一处定义**：`scripts/launcher-core/run.mjs`
 * 的 `LOG_LAYOUT` / `currentDir` / `runsDir`（写方用它归档）。这里直接 import
 * 那一份，不在端点里另拼 `log/runs/...` —— 两边一旦漂开，表现是「归档了但界面
 * 看不到」，而两边各自都「看起来是对的」。与 `POST /api/logs/diagnostics` 复用
 * `exportDiagnostics()` 是同一手法。
 *
 * 鉴权口径与 `current` 一致（同为本地日志文件的读取通道，且是同一批调用方），
 * 不额外要求登录态。
 *
 * 参数：
 *   - `source`：`RUNTIME_LOG_FILES` 的键；
 *   - `session`（可选）：要读的运行 id（`run:<包目录名>`；本次运行为 `run:current`）。
 *     缺省或已不在列表里时回落**本次运行**，实际选中项放进 `selectedId` 回给客户端
 *     —— 客户端据此同步下拉，而不是自己猜。
 */

/** 单次请求最多返回的正文字节数（约 40 万字符量级）。 */
const MAX_TEXT_BYTES = 400_000;

/** 下拉最多列出多少次运行（含本次）：再老的翻不到，列出来只是噪声。 */
const MAX_RUNS = 30;

/** 本次运行那一项的 id（它还没归档，因此没有包目录名）。 */
const CURRENT_ID = "run:current";

/** 项目根（`run.mjs` 的 `root`）—— `LOG_ROOT` 是 `<root>/log`，别再推导一次。 */
const ROOT = path.dirname(LOG_ROOT);

/**
 * 各 runtime 来源在 `current/` 下、以及运行包**包内**的相对路径。
 *
 * 两个位置用同一个相对路径是「一次运行一包」的性质：包就是 `current/` 的整目录
 * 副本（规范 §4），因此包内的相对位置与 `current/` 下逐字相同。写成一张表而不是
 * 每次从 `RUNTIME_LOG_FILES` 反推，是为了让来源的**新增**必须同批登记这里 ——
 * 漏登记的表现是那个来源在下拉里凭空少掉历史包，而不是静默读错文件。
 */
const SOURCE_REL: Record<string, string> = {
  "comfyui-runtime": "services/comfyui-runtime.log",
  "drizzle-studio-runtime": "services/drizzle-studio-runtime.log",
  "ollama-runtime": "services/ollama-runtime.log",
  "app-runtime": "services/app-runtime.log",
};

/** 空载荷（与 `current` 同口径：不给 404/500，界面据此显示空态而不是报错）。 */
function emptyPayload(error?: string): LogSessionsPayload & { error?: string } {
  return {
    sessions: [],
    selectedId: null,
    content: "",
    truncated: false,
    windowed: false,
    size: 0,
    baselineMissing: false,
    ...(error ? { error } : {}),
  };
}

/**
 * 读文件的 `[from, size)` 区间，超过 `maxBytes` 时取尾部窗口。
 *
 * 两种「掐头」必须分开，混成一个判据会**整整吃掉历史包正文的第一行**：
 *   - 尾部窗口把起点推后了（`start > base`）→ 窗口里那半行不属于本次返回的内容，
 *     丢掉它并如实回报 `windowed`；
 *   - `base` 来自前一份基准（`start === base > 0`）→ **不能丢**，那是本次新增行
 *     的开端。归档是按完整文件复制的，基准本来就落在行边界上。
 */
function readSlice(
  file: string,
  from: number,
  maxBytes: number,
): { text: string; windowed: boolean; size: number } {
  const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
  /* 起点两道夹：不为负、不越末尾（`from` 是「前一包的长度」，而文件可能比它短
   * ——那时该给空正文而不是抛 RangeError）。 */
  const base = clamp(from, 0, size);
  const start = Math.max(base, size - maxBytes);
  const length = size - start;
  if (length <= 0) return { text: "", windowed: start > base, size };
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  const raw = buf.toString("utf8");
  if (start > base) {
    const firstBreak = raw.indexOf("\n");
    return {
      text: firstBreak >= 0 ? raw.slice(firstBreak + 1) : "",
      windowed: true,
      size,
    };
  }
  return { text: raw, windowed: false, size };
}

/** 本次运行那一项（时刻与崩溃态取 `current/run.json`）。 */
function currentOption(): RuntimeLogRunOption | null {
  const meta = readRunJsonAt(currentDir(ROOT));
  if (!meta) return null;
  const startedAt =
    typeof meta.startedAt === "string" ? new Date(meta.startedAt).getTime() : 0;
  return {
    id: CURRENT_ID,
    title: "",
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
    scope: "current",
    crashed: meta.crashed === true,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "";
  const requested = searchParams.get("session");

  const rel = SOURCE_REL[source];
  const currentFile = RUNTIME_LOG_FILES[source];
  if (!rel || !currentFile) {
    return NextResponse.json(emptyPayload(`unknown source: ${source}`), {
      status: 400,
    });
  }

  try {
    const runs = runsDir(ROOT);
    const current = currentOption();
    const packs: RunPack[] = scanRunPacks({
      runsDir: runs,
      sourceRelPath: rel,
      runJsonName: LOG_LAYOUT.runJson,
      /* 上限是**下拉总共几项**：本次运行也占一格，因此历史包少留一个。 */
      limit: current ? MAX_RUNS - 1 : MAX_RUNS,
    });
    /* 列表的展示文案（含时刻 / 退出形态 / runId）统一由 `formatRunLabel` 给，
     * 视图不再自己拼一遍（两边各拼一次必然有一边先漂）。 */
    const sessions = buildRunOptions(current, packs).map((option) => ({
      id: option.id,
      title: formatRunLabel(option),
      startedAt: option.startedAt,
    }));

    const selectedId =
      sessions.find((session) => session.id === requested)?.id ??
      sessions[0]?.id ??
      null;
    if (selectedId === null) return NextResponse.json(emptyPayload());

    /* 判据用**列表里那一项**的 scope，不用 id 形态：本次运行的 id 是
     * `run:current`，而 `packNameOf` 对它返回 "current" —— 那是个真值，拿它
     * 去 `runs/current/...` 找文件必然扑空（表现是「切回本次运行正文空白」）。 */
    const isCurrent = selectedId === CURRENT_ID;
    const packName = isCurrent ? null : packNameOf(selectedId);
    const file = packName ? path.join(runs, packName, rel) : currentFile;
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) {
      return NextResponse.json({
        ...emptyPayload(),
        sessions,
        selectedId,
      });
    }

    /* 历史包要减去前一包；本次运行在 `current/`，它天生只有本次的内容。 */
    const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
    const baseline = packName ? runPackBaselineSize(runs, packName, rel) : null;
    const { from, baselineMissing } = runSlice(size, baseline);
    const { text, windowed } = readSlice(file, from, MAX_TEXT_BYTES);

    return NextResponse.json({
      sessions,
      selectedId,
      content: text,
      /* 正文没到文件末尾就是被截断了：起点之后还剩的字节数 > 返回的字符数时
       * 只可能是尾部窗口（`readSlice` 已经把窗口起点对齐到行首）。 */
      truncated: from + text.length < size,
      windowed,
      size,
      baselineMissing,
    } satisfies LogSessionsPayload);
  } catch (error) {
    return NextResponse.json(
      apiErrorBody(error, "读取日志会话失败", { ...emptyPayload() }),
      { status: 500 },
    );
  }
}
