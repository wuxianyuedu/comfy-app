/**
 * 「在文件管理器里定位一个路径」的判据用例。
 *
 * 两条判据各自钉住一半，缺一条都会让功能在真机上「看着对、点了不对」：
 *   1. **最长存在前缀**（纯逻辑 + 注入探针）：文本判据扫出来的候选常常多带一点
 *      尾巴（为 `Program Files` 让路的宽判据），退到哪一段为止是这里的判据；
 *   2. **命令 + 参数形态**（mock 掉 `child_process`）：`explorer /select,"<路径>"`
 *      必须是**单个参数**、不走 shell —— 拆成两个参数时含空格的路径会被 explorer
 *      自己截断，表现是「打开了资源管理器但什么都没选中」（本项目已有一次
 *      `"start"""` 引号剥离事故，见 `open-in-browser.ts` 头部）。
 *
 * mock 边界：`child_process` 换成可编程的假句柄，**绝不真起 explorer / open**。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cb = (...args: unknown[]) => void;

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("child_process", () => ({ spawn: spawnMock }));

import { resolveExistingPath, revealPathInFileManager } from "./reveal-path";

/** 假子进程：注册完 handler 后延一拍发 `spawn`（等价于「命令已交给 OS」）。 */
function installFakeChild(errorCode?: string) {
  spawnMock.mockImplementation(() => {
    const handlers: Record<string, Cb[]> = {};
    const handle = {
      on: (ev: string, cb: Cb) => {
        (handlers[ev] ??= []).push(cb);
      },
      unref: vi.fn(),
      pid: 4242,
    };
    setTimeout(() => {
      if (errorCode) {
        for (const cb of handlers.error ?? [])
          cb(
            Object.assign(new Error(`spawn ${errorCode}`), { code: errorCode }),
          );
        return;
      }
      for (const cb of handlers.spawn ?? []) cb();
    }, 0);
    return handle;
  });
}

/** 探针：只认集合里那几条（避免用例依赖真实磁盘）。 */
function probeFor(...existing: string[]) {
  const set = new Set(existing);
  return (candidate: string) => set.has(candidate);
}

beforeEach(() => {
  vi.clearAllMocks();
  installFakeChild();
});

describe("最长存在前缀解析", () => {
  it("整串就存在时原样返回（不画蛇添足地退）", () => {
    const exists = probeFor("F:\\a\\b\\c.log");
    expect(resolveExistingPath("F:\\a\\b\\c.log", exists)).toBe(
      "F:\\a\\b\\c.log",
    );
  });

  it("尾随半段文字时在**最后一段内**退到存在的那一截", () => {
    /* 现场：候选为了 `Program Files` 让路而吃空格，于是 `…\dev.mjs --mode x`
     * 裁开关后可能残留半个词。退到存在的文件名为止。 */
    const exists = probeFor("F:\\a\\b\\dev-launcher.mjs");
    expect(resolveExistingPath("F:\\a\\b\\dev-launcher.mjs x", exists)).toBe(
      "F:\\a\\b\\dev-launcher.mjs",
    );
  });

  it("**不穿过分隔符退**（否则会打开到用户没指的那一级）", () => {
    /* `F:\a` 存在但 `F:\a\b` 不存在：正确结果是 null 而不是 `F:\a` ——
     * 跨段退会命中 `F:\a`，于是用户点 `F:\a\b` 打开了 `F:\a`，
     * 界面上没有任何东西解释为什么。这是本函数唯一一条「宁可漏」的判据。 */
    expect(resolveExistingPath("F:\\a\\b", probeFor("F:\\a"))).toBeNull();
    expect(
      resolveExistingPath("F:\\a\\b\\c\\d", probeFor("F:\\a\\b")),
    ).toBeNull();
  });

  it("整段都多余时不退到父目录（宁可回 null 也不指错）", () => {
    /* 与上一条同源：`F:\a\b\junky` 里 `junky` 整段多余时，正确做法**不是**
     * 退到 `F:\a\b` —— 从字符串分不清「`junky` 是尾巴」与「`b` 是用户指的那一级」，
     * 而猜错就是打开了用户没指的目录。所以这里回 null，用户拿到「路径不存在」
     * 的反馈（有出口、可纠正）。文本侧的尾巴（标点、开关）在扫描阶段就已收干净，
     * 不该留到这里。 */
    const exists = probeFor("F:\\a\\b");
    expect(resolveExistingPath("F:\\a\\b\\junky", exists)).toBeNull();
  });

  it("不退成「目录 + 尾分隔符」那一档（否则点一个不存在的文件会打开它的目录）", () => {
    /* 现场：`/workspace/no-such-file.txt` 段内逐字符退，退到 `/workspace/` 时
     * **它在磁盘上当然存在**（父目录），于是「点一个不存在的文件」变成了
     * 「打开了那个目录」—— 跨段退的坏味道从另一个口子漏回来。判据据此把
     * 「结尾是分隔符」的候选一律跳过。 */
    const exists = probeFor("/workspace/");
    expect(
      resolveExistingPath("/workspace/no-such-file.txt", exists),
    ).toBeNull();
    expect(
      resolveExistingPath("F:\\a\\b\\missing.log", probeFor("F:\\a\\b\\")),
    ).toBeNull();
  });

  it("只退到最后一段的段首，盘符壳与根都不认", () => {
    expect(resolveExistingPath("F:\\nothing\\here", probeFor("F:"))).toBeNull();
    expect(resolveExistingPath("/nothing/here", probeFor("/"))).toBeNull();
  });

  it("空串与全空白回 null", () => {
    expect(resolveExistingPath("", () => true)).toBeNull();
    expect(resolveExistingPath("   ", () => true)).toBeNull();
  });
});

describe("命令与参数形态", () => {
  it('Windows 用 `explorer /select,"<路径>"` 且路径与 /select 同属一个参数', async () => {
    const target =
      process.platform === "win32" ? "C:\\a b\\c.log" : "/a b/c.log";
    const result = await revealPathInFileManager(target, probeFor(target));
    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    if (process.platform === "win32") {
      expect(cmd).toMatch(/cmd(\.exe)?$/i);
      /* `/select,"<路径>"` 必须是**一个**参数：拆成 `/select,` + 路径两个时，
       * explorer 会把含空格的路径截断（打开了但没选中）。 */
      expect(args.at(-1)).toBe(`/select,"${target}"`);
    } else if (process.platform === "darwin") {
      /* macOS：`open -R` 把**目标本身**交给 Finder（文件则选中它）。 */
      expect(args).toEqual(["-R", target]);
    } else {
      /* Linux：没有统一的「选中」协议，退化为打开**父目录**（点一个日志文件的
       * 意图是「到它那儿去」，用编辑器打开它不是）。 */
      expect(args).toEqual(["/a b"]);
    }
  });

  it("spawn 的是命令 + 参数数组，不是拼好的整串（不走 shell）", async () => {
    const target = "/var/log/app.log";
    await revealPathInFileManager(target, probeFor(target));
    const [, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { stdio?: string },
    ];
    expect(Array.isArray(args)).toBe(true);
    expect(args.some((a) => a.includes(" "))).toBe(false);
    expect(options.stdio).toBe("ignore");
  });

  it("路径不存在时不 spawn，并给出可读的失败说明", async () => {
    const result = await revealPathInFileManager(
      "F:\\nope\\missing.log",
      () => false,
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("找不到可在文件管理器里打开的路径");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawn 失败时回 ok:false 且带可手动打开的路径（硬规则 4）", async () => {
    installFakeChild("ENOENT");
    const target = "/var/log/app.log";
    const result = await revealPathInFileManager(target, probeFor(target));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(target);
    expect(result.revealed).toBe(target);
  });
});

describe("与文本判据串起来（端到端形态）", () => {
  it("从真实日志行扫出候选，再定位到存在的那一截", async () => {
    const { findLogPathTokens } = await import("~/lib/log/log-path-tokens");
    const line =
      "拉起到编排器: node F:\\AI\\Other\\app\\scripts\\dev-launcher.mjs --mode prebuilt （端口 3847）";
    const tokens = findLogPathTokens(line);
    expect(tokens).toHaveLength(1);
    const exists = probeFor("F:\\AI\\Other\\app\\scripts\\dev-launcher.mjs");
    const result = await revealPathInFileManager(tokens[0]!.text, exists);
    expect(result.ok).toBe(true);
    expect(result.revealed).toBe(
      "F:\\AI\\Other\\app\\scripts\\dev-launcher.mjs",
    );
  });
});
