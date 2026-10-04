// ── 「在文件管理器里定位一个路径」的唯一出口 ────────────────────────────────
//
// 用户反馈（ISSUE #1365）：日志面板里那一列路径看得见却点不动 —— 要打开得自己
// 抄进资源管理器。本模块是「点一下」这半边的落点：**路径 → 系统文件管理器**。
//
// ## 与既有两条通道的分工
//
// | 通道                          | 语义                                | 为什么不能直接复用                 |
// | ----------------------------- | ----------------------------------- | ---------------------------------- |
// | `~/lib/shell/open-in-browser` | 把控制权交给**默认浏览器**（http(s) 闸门） | 协议闸门只放行 http(s)，路径进不去 |
// | `comfyapp://` 协议助手        | 打开**产物根内**的目录（注册表 + 白名单两层） | 需要一次性注册安装，且限 `generated/` |
// | 本模块                        | 在文件管理器里**定位**任意本机路径   | ——                                 |
//
// 「打开目录」那两条此前各有一套（协议助手在 HistoryDetailModal 里带一套「协议有没
// 有接管」的探测）；本模块走的是**本机 spawn**，不需要注册、不需要浏览器确认弹窗，
// 也不受 `generated/` 白名单限制 —— 而日志里的路径（编排脚本、`.next` 缓存、
// `run/launch-status.json`）恰恰大多不在产物根里，那正是用户点不动它们的原因。
//
// ## 为什么不加 `server-only`
//
// 走 §18.4 第三类（纯 Node 宿主）：与 `kill-process-tree.ts` / `output-paths.ts`
// 同族 —— 顶层 Node 内建 import、由 Next 服务端（本模块的消费方是 tRPC 路由）与
// 纯 Node 宿主共用同一份实现。这里加 `server-only` 不会带来任何保护（它的消费方
// 本来就是服务端），却会让「同一份实现在纯 Node 侧不可加载」这条**无形**的边界
// 变成一道错误。登记见 `tests/lib-node-only-declarations.test.ts` 的
// `PURE_NODE_HOSTS`。
//
// ## 判据的最终形态是「磁盘上真有这个东西」
//
// 调用方给的是**从日志文本里扫出来的候选**（`~/lib/log/log-path-tokens`），它可能
// 带着一个词（`F:\a\dev.mjs ` 这种为 `Program Files` 让路的宽判据）。所以这里做
// 「**最长存在前缀**」解析：从完整候选往回退，第一个存在的路径就是答案。这让
// 「文本切得不够准」不再是失败 —— 文本负责「像」，文件系统负责「是不是」。
import { statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { errorText } from "~/lib/error-message";

export interface RevealPathResult {
  /** 是否真的把「打开」指令交给了系统。 */
  ok: boolean;
  /** 给用户看的说明（成功也带 —— 一句「已在资源管理器定位」是唯一能看到点了有反应的证据）。 */
  detail: string;
  /** 实际被定位的路径（空壳时给出，用户能看出「点的是这段文本」）。 */
  revealed?: string;
}

/**
 * 探针：某个路径当前存在吗（文件或目录都算）。
 *
 * 抽成参数是为了让「最长存在前缀」那条纯逻辑可脱离真实文件系统单测 ——
 * 判据（退到哪一段为止）与探针（磁盘上有没有）是两件事。
 */
export type ExistsProbe = (candidate: string) => boolean;

/** 真探针：文件或目录都算存在；`statSync` 抛错（不存在 / 无权限）即 false。 */
const diskExists: ExistsProbe = (candidate) => {
  try {
    statSync(candidate);
    return true;
  } catch {
    return false;
  }
};

/**
 * 把候选收成**最长存在前缀**（不存在则 null）。
 *
 * 为什么是「前缀」而不是「整串」：候选由文本判据扫出来，为 `Program Files` 这类
 * 带空格的路径让过路，于是常常多带一点尾巴（`F:\a\b.log。` 的残留、裁开关留下的
 * 半个词）。往回逐字符退，第一个在磁盘上真有的就是用户要的那个。
 *
 * **退法只在最后一段内**（不穿过分隔符、也不整段整段地退）。这条限制是刻意的：
 * 整段退会退出一堆「路径片断」（`F:\a`、`F:\a\b`），它们**可能真存在**，于是
 * 「打开到哪里」完全取决于哪一级先命中 —— 用户点 `F:\a\b\c` 却打开了 `F:\a`，
 * 而界面上没有任何东西解释为什么。**比不可点更糟**（与文本判据里「不认相对路径」
 * 同一条原则：宁可漏，不可指错）。
 *
 * 那「多带了一整段」怎么办？—— 不需要这里管：候选里的多余内容**一定落在最后一段
 * 内**。尾随标点、裁剩的开关、连进来的普通词都出现在最后一个分隔符之后
 * （`…\dev-launcher.mjs --mode prebuilt` 的 `--mode prebuilt` 就在最后一段里）。
 * 真出现「整段多余」时结果为 null，用户拿到「路径不存在」的反馈（有出口、可纠正）。
 */
export function resolveExistingPath(
  candidate: string,
  exists: ExistsProbe = diskExists,
): string | null {
  const raw = candidate.trim();
  if (raw === "") return null;
  if (exists(raw)) return raw;

  /* 最后一段的起点：最后一个分隔符之后。段内逐字符退。 */
  const sepIndex = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  for (let end = raw.length - 1; end >= sepIndex + 1; end -= 1) {
    const head = raw.slice(0, end);
    if (head === "") continue;
    /* **退到「目录 + 尾分隔符」那一档就停**（`/a/b` 的候选退成 `/a/`）：它在磁盘上
     * 当然存在（父目录），认它就等于「点一个不存在的文件 → 打开了那个目录」——
     * 而用户点的是文件。这正是「跨段退」的坏味道从另一个口子漏回来的形态
     * （实测撞出来：`/workspace/no-such-file.txt` 被解析成 `/workspace/`）。 */
    if (head.endsWith("/") || head.endsWith("\\")) continue;
    if (exists(head)) return head;
  }
  return null;
}

/** 各平台「在文件管理器里定位」的命令与参数（判据只在这里出现一次）。 */
function revealCommand(target: string): { cmd: string; args: string[] } {
  const platform = process.platform;
  if (platform === "win32") {
    /* `explorer /select,"<路径>"`：文件则选中它、目录则展开它所在的一层。
     * **必须是单个参数** `/select,"<路径>"` 形态 —— explorer 对 argv 的切分是
     * 自成一体的（它把 `/select,` 与路径当成一个整体解析），拆成两个参数时
     * 含空格的路径会被截断，表现为「打开了资源管理器但没选中任何东西」。
     * `/select` 对目录同样有效（选中该目录本身），所以文件与目录同一条路径。 */
    return {
      cmd: process.env.ComSpec ?? "cmd.exe",
      args: ["/c", "start", "", "explorer", `/select,"${target}"`],
    };
  }
  if (platform === "darwin") {
    /* `open -R` 在 Finder 里选中；对目录同样成立。 */
    return { cmd: "open", args: ["-R", target] };
  }
  /* Linux：没有统一的「选中」协议（各文件管理器自定义），退化为打开所在目录。
   * 文件时打开它的**父目录**而不是文件本身 —— 点一个日志文件的意图是「到它那儿
   * 去」，用编辑器打开它不是。 */
  const dir = statSync(target, { throwIfNoEntry: false })?.isDirectory()
    ? target
    : path.dirname(target);
  return { cmd: "xdg-open", args: [dir] };
}

/**
 * 在系统文件管理器里定位一个路径。
 *
 * 失败一律回 `{ ok: false, detail }` 而不是抛：调用链把 detail 原样显示给用户
 * （硬规则 4：失败路径必须有用户可见出口）。三种失败各自有话说 ——
 * 路径不存在（磁盘上真没有）、路径不是绝对路径（端点那层的闸门挡的）、
 * spawn 失败（没有文件管理器 / 权限）。
 */
export async function revealPathInFileManager(
  candidate: string,
  exists: ExistsProbe = diskExists,
): Promise<RevealPathResult> {
  const target = resolveExistingPath(candidate, exists);
  if (target === null) {
    /* 失败说明**不区分**「文件不存在」与「在检出目录之外」：两道判据合成在同一个
     * 探针里（见 `~/server/api/routers/setting` 的 `revealPath`），这里分不出来
     * —— 而分开说也不该：把「界外」这个结论回给请求方，等于把本机的目录结构当
     * 探测接口。给的是同一句可行动的说明（怎么都不行时用户能做什么）。 */
    return {
      ok: false,
      detail: `找不到可在文件管理器里打开的路径（本机不存在，或不在本项目检出目录内）：${candidate.trim() || "(空)"}`,
      revealed: candidate.trim(),
    };
  }
  const { cmd, args } = revealCommand(target);
  try {
    await new Promise<void>((resolve, reject) => {
      /* 不走 shell：Node 按数组直接构造命令行，含空格的路径原样送达，不经 cmd
       * 二次引号剥离（与 `open-in-browser` 同一条血泪教训）。Windows 那一路的
       * `start` 是 cmd 内建命令，由 `cmd /c` 承载 —— 第一个 `""` 是标题占位，
       * 防止接下来的参数被 `start` 当成窗口标题。 */
      const cp = spawn(cmd, args, { stdio: "ignore", windowsHide: true });
      cp.on("error", reject);
      cp.on("spawn", () => {
        /* spawn 成功即认为指令已送达（资源管理器由系统拉起），不等子进程退出：
         * `explorer` 会把请求转给**已经在跑的那个**实例后立刻退出，等它等于等一个
         * 与「有没有打开」无关的进程。 */
        cp.unref();
        resolve();
      });
    });
    return {
      ok: true,
      detail: `已在文件管理器里定位：${target}`,
      revealed: target,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `${errorText(error, "打开文件管理器失败")}。可手动打开：${target}`,
      revealed: target,
    };
  }
}
