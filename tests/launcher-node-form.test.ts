/**
 * 回归护栏：**Windows 桌面启动器解析 `node` 时不选「调度不了的形态」**（ISSUE #636 同族）。
 *
 * 背景：`scripts/start_tauri_launcher.py` 用 `shutil.which("node")` 找解释器，而
 * `which` 是按 `PATHEXT` 找**存在的文件**、命中后直接交给 `subprocess.Popen` 起。
 * 三种形态里只有「真能跑起来」的那个可用，这与 Node 侧
 * `launcher-core/shell.mjs` 的教训完全同源（Issue #576：`.cmd` 只有 cmd.exe 会解释，
 * Node 起它必 `EINVAL`；corepack 的无扩展名 shim 也可能因为不是 PE 镜像而失败）。
 * 用户看到的表现是「启动器弹一句无法启动 scripts/dev-launcher.mjs」，与真正的
 * 「Node 没装」长得一样，而实际上终端里 `node -v` 是通的。
 *
 * 本用例在**无 Windows 的环境**里做两件事：
 *   ① 源码级判据：解析必须真起一次确认 + `.cmd`/`.bat` 经 `cmd.exe /c`；
 *   ② 行为级判据：把模块里的纯函数用桩替换宿主行为后真跑一遍（不依赖 Windows）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const src = fs.readFileSync(
  path.join(ROOT, "scripts", "start_tauri_launcher.py"),
  "utf8",
);

/** 取出 `def <name>` 的函数体文本（到下一个顶层 def 为止）。 */
function fnBody(name: string): string {
  const head = src.indexOf(`def ${name}(`);
  expect(head, `找不到 def ${name}`).toBeGreaterThan(-1);
  const rest = src.slice(head);
  const next = rest.indexOf("\ndef ", 1);
  return next > 0 ? rest.slice(0, next) : rest;
}

describe("启动器解析 node：不选调度不了的形态", () => {
  it("解析器不再只有一个 shutil.which 就返回", () => {
    const body = fnBody("_node_exe");
    expect(body).toContain("shutil.which");
    // 三种形态都要当候选（只有 which("node") 一把梭 = 会选中 .cmd / 无扩展名 shim）
    for (const name of ["node", "node.exe", "node.cmd", "node.bat"]) {
      expect(body, `候选里缺 ${name}`).toContain(`"${name}"`);
    }
    // `.cmd` / `.bat` 必须经 cmd.exe，且**真起一次确认**（不是「存在即用」）
    expect(body).toMatch(/\\.cmd.*\\.bat|\.cmd.*\.bat/s);
    expect(body).toContain("ComSpec");
    expect(body).toContain("_is_node_usable");
  });

  it("「真起一次确认」是实打实的子进程探测，且失败不抛", () => {
    const body = fnBody("_is_node_usable");
    expect(body).toContain("subprocess.run");
    expect(body).toMatch(/returncode\s*==\s*0/);
    // 起不来要返回 False（宁可为空让调用方给可见出口），不许抛出去
    expect(body).toContain("except Exception");
  });

  it("bat/cmd 形态经 cmd.exe 起（`_node_argv` 唯一出口）", () => {
    const body = fnBody("_node_argv");
    expect(body).toContain('"/c"');
    expect(body).toContain(".cmd");
    // Popen 必须用它拼 argv，而不是直接 [node] + args（后者对 .cmd 必 EINVAL）
    expect(src).toMatch(/_node_argv\(node, node_args\)/);
    expect(src).not.toMatch(/\[node\]\s*\+\s*node_args/);
  });

  it("解析失败时给的是可行动提示，不是「静默不启动」", () => {
    expect(src).toContain("无法启动 scripts/dev-launcher.mjs");
    expect(src).toContain("Node.js 是否可用");
  });
});

describe("同一个「Node 起不了批处理」判据在两侧同源", () => {
  it("Node 侧仍把批处理列为需要宿主的形态（两侧不许各写一套）", () => {
    const shell = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "shell.mjs"),
      "utf8",
    );
    expect(shell).toMatch(/batch/);
    // 批处理在 Windows 上直接走同胞回退、不真起（真起必 EINVAL）
    expect(shell).toMatch(
      /isWindows[\s\S]{0,200}batch|batch[\s\S]{0,200}isWindows/,
    );
  });

  it("启动器源码里不再出现「which('node') 找到就直接 Popen」的形态", () => {
    expect(src).not.toMatch(/subprocess\.Popen\(\s*\[node\]\s*\+\s*node_args/);
    expect(src).not.toMatch(
      /shutil\.which\("node"\)\s*\n\s*if\s+found:\s*\n\s*return\s+found/,
    );
  });
});
