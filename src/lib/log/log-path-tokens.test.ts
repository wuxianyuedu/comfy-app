/**
 * 日志行路径识别的判据用例。
 *
 * 首条断言直接用**用户贴图里那几行原文**（ISSUE #1365）：这些是本模块存在的理由，
 * 任何一条认不出来，「路径能点开」就是空话。其余按形状分组钉住边界 —— 尤其是
 * 「宁可漏」的那几档（相对路径、散文、除号分片），它们一旦被认成路径，用户点开
 * 会到一个「不是那里的文件夹」，比不可点更糟。
 */
import { describe, expect, it } from "vitest";

import { findLogPathTokens } from "./log-path-tokens";

/** 取出这一行里所有被认成路径的文本。 */
function paths(line: string): Array<string> {
  return findLogPathTokens(line).map((t) => t.text);
}

describe("日志行路径识别（ISSUE #1365 的用户原文）", () => {
  const ROOT = String.raw`F:\AI\Other\comfy-app-t3-branch4`;

  it("启动报告里的四行路径逐条认出，且不留尾随字符", () => {
    expect(paths(`项目根: ${ROOT}`)).toEqual([ROOT]);
    expect(paths(`编排脚本: ${ROOT}\\scripts\\dev-launcher.mjs`)).toEqual([
      `${ROOT}\\scripts\\dev-launcher.mjs`,
    ]);
    expect(paths(`启动状态文件: ${ROOT}\\run\\launch-status.json`)).toEqual([
      `${ROOT}\\run\\launch-status.json`,
    ]);
    expect(paths(`编排链路日志: ${ROOT}\\log\\launcher\\shell-launch.log`)).toEqual([
      `${ROOT}\\log\\launcher\\shell-launch.log`,
    ]);
  });

  it("一行两段路径各认一段（逗号并列）", () => {
    expect(
      paths(
        `拉起到编排器: node ${ROOT}\\scripts\\dev-launcher.mjs --mode prebuilt （端口 3847, 来源: 按检出路径推导（3200~3999）, cwd ${ROOT}）`,
      ),
    ).toEqual([`${ROOT}\\scripts\\dev-launcher.mjs`, ROOT]);
  });

  it("引号里的 exe / ps1 不吃引号，也不吃后面的开关", () => {
    expect(
      paths(
        `>>> "C:\\Program Files\\PowerShell\\7\\pwsh.EXE" -NoProfile -ExecutionPolicy Bypass -File "D:\\Program Files\\nodejs\\pnpm.ps1" -v`,
      ),
    ).toEqual([
      String.raw`C:\Program Files\PowerShell\7\pwsh.EXE`,
      String.raw`D:\Program Files\nodejs\pnpm.ps1`,
    ]);
  });

  it("收掉尾部句子标点（全角括号 + 句号两层）", () => {
    expect(paths("allowedRoot: /workspace/generated （见 §1.1）。")).toEqual([
      "/workspace/generated",
    ]);
    expect(paths(String.raw`路径：F:\a\b.log。后面还有中文`)).toEqual([String.raw`F:\a\b.log`]);
  });

  it("POSIX 形态与 UNC 形态都认", () => {
    expect(paths("  1) 壳侧编排链路（壳自己写的）：/workspace/log/launcher/x.log")).toEqual([
      "/workspace/log/launcher/x.log",
    ]);
    expect(paths(String.raw`resolved to \\server\share\dir\x.log`)).toEqual([
      String.raw`\\server\share\dir\x.log`,
    ]);
  });
});

describe("日志行路径识别：刻意漏的那几档", () => {
  it("相对路径不认（判不了相对谁，猜错会到别的文件夹）", () => {
    expect(paths("shell log: log/shell/shell.log")).toEqual([]);
    expect(paths("见 ./src/lib/log.ts 与 src/lib/log/log-store.ts:12")).toEqual([]);
  });

  it("URL 里不切出裸路径段", () => {
    expect(paths("见 https://cnb.cool/moon-read/comfy-app-t3/-/issues/1365")).toEqual([]);
    expect(paths("http://127.0.0.1:3100/workspace/x")).toEqual([]);
  });

  it("除号分片不算路径（`/ 0 /` 这类写法在日志里很常见）", () => {
    expect(paths("count 1769 / 0 / 3")).toEqual([]);
    expect(paths("信息 1769 / 警告 0 / 错误 0")).toEqual([]);
  });

  it("POSIX 形态只有一段时不认", () => {
    expect(paths("progress 42% (12/29)")).toEqual([]);
    expect(paths(String.raw`分隔符 / 与 \ 都是硬字符`)).toEqual([]);
  });

  it("纯散文一行不认", () => {
    expect(paths("阶段: 壳已接手（双击 app.exe）")).toEqual([]);
    expect(paths("保留 .next 缓存（首次启动：写入初始指纹）")).toEqual([]);
  });
});

describe("日志行路径识别：边界形状", () => {
  it("盘符 / UNC 起点把空格吃进来（Program Files 是一整段）", () => {
    expect(paths(String.raw`at F:\with space\file name.txt`)).toEqual([
      String.raw`F:\with space\file name.txt`,
    ]);
  });

  it("POSIX 起点不吃空格（否则 `a and b`、并列路径会连成一段）", () => {
    expect(paths("paths: /a/b/c.log and /d/e/f.log")).toEqual(["/a/b/c.log", "/d/e/f.log"]);
  });

  it("成对括号留给文件名，落单的右括号才裁", () => {
    expect(paths(String.raw`installer at C:\Program Files (x86)\x.exe`)).toEqual([
      String.raw`C:\Program Files (x86)\x.exe`,
    ]);
    expect(paths("（日志：/var/log/app.log)")).toEqual(["/var/log/app.log"]);
  });

  it("尾随开关裁到路径为止（含 `--k=v` 与 `--k v` 两种写法）", () => {
    expect(paths(String.raw`cmd F:\a\b\d.mjs --mode prebuilt`)).toEqual([String.raw`F:\a\b\d.mjs`]);
    expect(paths(String.raw`cmd F:\a\b\d.mjs --port=3847`)).toEqual([String.raw`F:\a\b\d.mjs`]);
  });

  it("盘符根目录本身是合法路径（可以点开）", () => {
    /* `C:\` 两字符就是盘根，是真实存在的路径 —— 这里刻意**认**它：
     * 判据要的是「点开有意义」，盘根点开就是盘根。 */
    expect(paths("drive C:\\")).toEqual(["C:\\"]);
  });

  it("空格把普通词连进来时照样认（存在性由端点定案，不在这里猜）", () => {
    /* 这是「盘符形态吃空格」的代价：`C:\ then` 会被认成一段候选。它**故意**留到
     * 端点侧判 —— 那里能问文件系统「最长存在前缀是什么」，而这里只有文本。
     * 猜错的后果是用户点一下看到「路径不存在」的反馈（有出口、可纠正），
     * 而猜得过紧的后果是 `C:\Program Files\…` 被切成 `C:\Program`
     * —— 那是一段**看起来能点、点了什么都不是**的片段，更糟。 */
    expect(paths(String.raw`drive C:\ then`)).toEqual([String.raw`C:\ then`]);
  });

  /* ISSUE #1695：访问日志里的 URL 与真磁盘路径**同为 `/` 起头**，形状判据分不开，
   * 于是面板把每条请求行的 URL 都画成紫色的可点片段 —— 用户看到的是「满屏点开都
   * 说找不到的入口」。这一组的行取自真实 `nextjs-panel` 转录（见 log/current/）。 */
  it("HTTP 请求行里的 URL 不是磁盘路径（各方法、各前缀形态）", () => {
    expect(paths("GET /api/schema 200 in 31ms (next.js: 9ms)")).toEqual([]);
    expect(paths("GET /api/update-check 200 in 65ms")).toEqual([]);
    expect(paths("GET /api/dev/build-id 200 in 57ms")).toEqual([]);
    expect(paths("GET /api/comfy/queue 200 in 2.5s")).toEqual([]);
    expect(paths("GET /api/comfy/stats 200 in 2.5s")).toEqual([]);
    expect(paths("GET /api/trpc/model.configList 200 in 5ms")).toEqual([]);
    expect(paths("POST /api/comfy/ensure 200 in 400ms")).toEqual([]);
    expect(paths("OPTIONS /api/schema 204")).toEqual([]);
    /* 请求行的**查询串**同样不认：`/api/logs/current?source=…` 是本面板自己的
     * 轮询端点（与 `isPanelSelfPollingLine` 同一族行）。 */
    expect(paths("GET /api/logs/current?source=app-runtime 200 in 12ms")).toEqual([]);
  });

  it("带时刻 / 级别前缀的请求行照样不认（面板里就是长这样）", () => {
    expect(paths("[18:44:13] [INFO] GET /api/comfy/queue 200 in 2.5s (next.js: 20ms)")).toEqual([]);
  });

  /* 第二条**真实**形态（实测从 564KB 的 nextjs-panel 转录里扫出来的唯一漏网者）：
   * Next dev 按需编译时把路由名打在 `Compiling` 后面 —— 这行没有 HTTP 方法，
   * 只有「动词 + 空格 + 路由」这一条线索。 */
  it("Next 的 `Compiling <route>` 行不是磁盘路径", () => {
    expect(paths("○ Compiling /api/comfy/stats ...")).toEqual([]);
    expect(paths("○ Compiling / ...")).toEqual([]);
  });

  it("框架资源命名空间不是磁盘路径", () => {
    expect(paths("GET /_next/static/chunks/main.js 200")).toEqual([]);
  });

  it("`/` 单独一个（根路由）本来就不认", () => {
    expect(paths("GET / 200")).toEqual([]);
  });

  it("**左侧与方法无关**的真磁盘路径照旧认（防这条判据收得过宽）", () => {
    /* 这几条与上面同样以 `/` 起头、同样出现在日志里，但左侧没有 HTTP 方法 ——
     * 判据必须只挡请求行，不能把「以 `/` 起头的绝对路径」整类端掉。 */
    expect(paths("shell log: /workspace/log/launcher/shell.log")).toEqual([
      "/workspace/log/launcher/shell.log",
    ]);
    expect(paths("/var/log/app.log")).toEqual(["/var/log/app.log"]);
    expect(paths("log at /home/user/data/a.txt")).toEqual(["/home/user/data/a.txt"]);
    /* `GET` 出现在**别的**位置（不是紧挨着这个候选）时不该误伤。 */
    expect(paths("GET 完成，日志在 /workspace/log/x.log")).toEqual(["/workspace/log/x.log"]);
  });

  it("盘符 / UNC 不受 URL 判据影响（它们不可能是 URL）", () => {
    expect(paths(String.raw`cmd C:\Program Files\x.exe`)).toEqual([
      String.raw`C:\Program Files\x.exe`,
    ]);
    expect(paths(String.raw`GET \\server\share\x.log`)).toEqual([String.raw`\\server\share\x.log`]);
  });

  it("回的是半开区间，切出来与 text 一致", () => {
    const line = `项目根: F:\\AI\\x`;
    for (const token of findLogPathTokens(line)) {
      expect(line.slice(token.start, token.end)).toBe(token.text);
    }
  });
});
