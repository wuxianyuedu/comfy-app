/**
 * ISSUE #1164 的判据：起 Python 子进程的两条链路都必须把解释器锁在 UTF-8。
 *
 * 为什么这条必须用**源码形状**判而不是跑一次：本机的 `python-venv/comfy-cli` 与
 * ComfyUI 安装都是用户自备件，用例不能假装它们存在（规范硬规则：写日志/起进程的
 * 用例只碰自己的临时目录）。而这件事的失效方式是静默的 —— 少给一个 env 键，
 * 面板只是变成乱码，任务只是偶发失败，没有任何类型或断言会红。
 *
 * 取证（中文 Windows / CP936，实测于 python-venv/comfy-cli 那一份解释器）：
 *   不注入            → `sys.stdout.encoding = gbk`，输出按 UTF-8(fatal) 解**解不动**（= 乱码）
 *   只给 PYTHONIOENCODING=utf-8 → stdio 变 utf-8，但 `open()` 仍按 gbk 读，
 *                              读我们写的 UTF-8 工作流文件直接 `UnicodeDecodeError`、exit=1
 *   给 PYTHONUTF8=1            → stdio 与 `open()` 两边都是 utf-8，中文复原
 *   ⇒ 两个都要给；只给 `PYTHONIOENCODING` 是半个修复（本条第二用例钉的就是这一手）。
 *
 * 注释要先剥掉再匹配（`./helpers/strip-comments`）：本文件与被扫文件都会用中文解释
 * 「为什么要这么写」，拿原文去匹配就会红在一行文档上。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(__dirname, "..");

/**
 * 取出「喂给 spawn 的那一份 env 字面量」里的键名。
 * 两条链路给它起的名字不一样（comfy-cli 是 `env:`，ComfyUI 本体是 `stdioEnv:`），
 * 所以按**大括号配平**扫出所有这类对象字面量，再挑出装着 `PYTHON*` 键的那一个 ——
 * 用「含 PYTHONUNBUFFERED」当选择器是错的（ComfyUI 那一份没有这个键），
 * 第一版就是这么判的、直接把另一条链路判成「找不到」。
 */
function pythonEnvKeys(rel: string): { name: string; keys: string[] } {
  const src = stripComments(readFileSync(path.join(ROOT, rel), "utf8")).replace(
    /\r\n/g,
    "\n",
  );
  const found: { name: string; keys: string[] }[] = [];
  const head = /(?:^|[\s,(])(env|stdioEnv|childEnv)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(src))) {
    const start = src.indexOf("{", m.index);
    if (start < 0) continue;
    let depth = 0;
    let i = start;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(start + 1, i);
    const keys = [...body.matchAll(/([A-Z][A-Z0-9_]*)\s*:/g)].map((k) => k[1]!);
    if (keys.some((k) => k.startsWith("PYTHON")))
      found.push({ name: m[1]!, keys });
  }
  expect(
    found.length,
    `${rel} 里没找到带 PYTHON* 键的 env 字面量 —— 要么编码口径被搬走了，要么本判据的` +
      "选择器（键名 / 形状）需要跟着改。**别**为了变绿把期望键塞进别的对象里。",
  ).toBeGreaterThan(0);
  return found[0]!;
}

describe("Python 子进程必须被锁在 UTF-8（ISSUE #1164）", () => {
  it("comfy-cli 那条链路：两个编码键都在（行缓冲那一条也还在）", () => {
    const { name, keys } = pythonEnvKeys("src/lib/comfyui/executor-cli.ts");
    expect(name, "comfy-cli 的 spawn 选项里这一份应当就叫 env").toBe("env");
    expect(keys).toContain("PYTHONUTF8");
    expect(keys).toContain("PYTHONIOENCODING");
    // #1184 那一条与这条是同一次 spawn 的兄弟判决，一起钉住免得后被改没
    expect(keys).toContain("PYTHONUNBUFFERED");
  });

  it("两条管道都显式按 utf-8 解 —— 写侧锁了 UTF-8，读侧不能跟着漂", () => {
    /* 这一条与上一条是一对：Python 被要求输出 UTF-8 之后，Node 这侧的解码必须
     * 明确跟上。`setEncoding` 缺省时 chunk 会以 Buffer 交出、被隐式按 utf8 转字符串，
     * 看起来也能过 —— 但那条形态下次有人改成 Buffer.concat + 别的解码就没人拦了。
     * 实测的乱码链正是「写侧 GBK / 读侧 UTF-8」这一对错位。 */
    const src = stripComments(
      readFileSync(path.join(ROOT, "src/lib/comfyui/executor-cli.ts"), "utf8"),
    );
    const decodes = [...src.matchAll(/\.setEncoding\(\s*"([^"]+)"\s*\)/g)].map(
      (m) => m[1],
    );
    expect(decodes.length).toBeGreaterThanOrEqual(2); // stdout + stderr
    expect(new Set(decodes)).toEqual(new Set(["utf-8"]));
  });

  it("ComfyUI 本体那条链路保持着同一口径（自定义节点 print emoji 会崩进程）", () => {
    const { keys } = pythonEnvKeys("src/lib/comfyui/lifecycle-launch.ts");
    expect(keys).toContain("PYTHONUTF8");
    expect(keys).toContain("PYTHONIOENCODING");
  });
});
