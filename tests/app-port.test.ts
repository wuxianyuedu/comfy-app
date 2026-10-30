import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  derivePortFromPath,
  FALLBACK_PORT,
  fnv1a32,
  normalizeRootForPort,
  parseDotEnvPortValue,
  readEnvFileValue,
  readEnvPort,
  resolveAppPort,
  resolveAppPortWithSource,
  resolveRepoRoot,
} from "../scripts/app-port.mjs";

/**
 * 应用端口解析契约（launch-and-build.md §1.1 / §1.4 多检出并行）。
 *
 * 推导算法是多语言约定（PowerShell / Python / Rust 各有同型实现），这里锁住
 * Node 侧行为与固定校验向量——向量由真实路径生成，四侧实现对同一输入必须
 * 得出同一端口，改动算法前先想清楚多检出并行会怎么被破坏。
 */
describe("app-port 端口解析", () => {
  it("路径规范化：反斜杠转正斜杠 + 转小写 + resolve", () => {
    expect(normalizeRootForPort("F:\\AI\\Other\\comfy-app-t3-branch")).toBe(
      "f:/ai/other/comfy-app-t3-branch",
    );
  });

  it("FNV-1a 32 位对固定输入给出稳定向量（跨语言一致性锚点）", () => {
    expect(fnv1a32("f:/ai/other/comfy-app-t3-branch")).toBe(0x97ecb3a9);
  });

  it("按检出路径推导的端口落在 3200..3999，且同路径恒定、异路径可分", () => {
    const a = derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch");
    const again = derivePortFromPath("F:/AI/Other/comfy-app-t3-branch");
    const b = derivePortFromPath("F:\\AI\\Other\\comfy-app-t3-branch2");
    expect(a).toBe(3305);
    expect(again).toBe(a); // 同一检出（分隔符/大小写差异）必须同一端口
    expect(b).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(3200);
    expect(a).toBeLessThanOrEqual(3999);
  });

  it(".env 显式 COMFYAPP_PORT 优先于路径推导", () => {
    // 本仓库真实的 .env 显式钉了 COMFYAPP_PORT（开发者的主检出保持 3100），
    // 因此这里用临时目录造 .env 验证优先级，不依赖仓库当前配置。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-"));
    try {
      fs.writeFileSync(path.join(tmp, ".env"), 'COMFYAPP_PORT="4321"\n', "utf8");
      expect(readEnvPort(tmp)).toBe(4321);
      expect(resolveAppPort(tmp)).toBe(4321);

      fs.writeFileSync(path.join(tmp, ".env"), "COMFYAPP_PORT=not-a-number\n", "utf8");
      expect(readEnvPort(tmp)).toBeNull();
      expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));

      fs.writeFileSync(path.join(tmp, ".env"), "", "utf8");
      expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("规范化与 cwd 无关：绝对路径原样处理，不拼当前工作目录", () => {
    // 回归锁：历史实现无条件 path.resolve()，而它的语义是「相对 cwd 解析」——
    // 在 Linux 上 path.resolve("F:\\AI\\...") 会得到 /workspace/f:/ai/...，
    // 同一检出在不同 cwd / 不同平台推出不同端口，「同一检出恒定同端口」失效。
    const win = "F:\\AI\\Other\\comfy-app-t3-branch";
    const cwd = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(normalizeRootForPort(win)).toBe("f:/ai/other/comfy-app-t3-branch");
      expect(derivePortFromPath(win)).toBe(3305);
    } finally {
      process.chdir(cwd);
    }
    // 回到本仓库 cwd 后仍是同一个值。
    expect(normalizeRootForPort(win)).toBe("f:/ai/other/comfy-app-t3-branch");
  });

  it("尾斜杠与分隔符写法不影响端口（POSIX 检出同样稳定）", () => {
    expect(normalizeRootForPort("/workspace/")).toBe("/workspace");
    expect(derivePortFromPath("/workspace/")).toBe(derivePortFromPath("/workspace"));
  });

  it("端口来源可归因（.env / 路径推导 / 兜底）", () => {
    // 只给数字的解析在「dev server 在 3100、壳在等 3809」时归不了因：看不出是
    // .env 写的还是路径推出来的，而这两种情况的修法完全不同（ISSUE #821）。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-src-"));
    try {
      expect(resolveAppPortWithSource(tmp)).toEqual({
        port: derivePortFromPath(tmp),
        source: "derived",
      });
      fs.writeFileSync(path.join(tmp, ".env"), "COMFYAPP_PORT=4321\n", "utf8");
      expect(resolveAppPortWithSource(tmp)).toEqual({ port: 4321, source: "env" });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".env 单值解析：形态与另三侧严格对齐（成对引号 / 行尾注释 / 注释行）", () => {
    // 四侧读的是同一份 .env（Node / PowerShell / Python / Rust）。任一侧对下面
    // 任一形态的理解不一致，用户写死的端口就只对一部分进程可见，剩下的按路径
    // 推导去等另一个端口 —— 现象是启动页卡在「等 dev server」（ISSUE #821）。
    // 逐条与 tests/fixtures/app-port-vectors.json 的 envVectors 同源。
    expect(readEnvFileValue("COMFYAPP_PORT=3100", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue('COMFYAPP_PORT="3100"', "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("COMFYAPP_PORT='3100'", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("COMFYAPP_PORT = 3100", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("  COMFYAPP_PORT=3100", "COMFYAPP_PORT")).toBe("3100");
    expect(readEnvFileValue("COMFYAPP_PORT=3100   # 固定端口", "COMFYAPP_PORT")).toBe("3100");
    // `abc#def` 里的 `#` 是值的一部分，不能当注释切掉。
    expect(readEnvFileValue("COMFYAPP_PORT=abc#def", "COMFYAPP_PORT")).toBe("abc#def");
    // 整行注释（.env.example 的示例行）不算配置；键名子串不算匹配。
    expect(readEnvFileValue("# COMFYAPP_PORT=3100\n", "COMFYAPP_PORT")).toBeNull();
    expect(readEnvFileValue("OTHER_COMFYAPP_PORT=3100", "COMFYAPP_PORT")).toBeNull();
    expect(readEnvFileValue("", "COMFYAPP_PORT")).toBeNull();
  });

  it(".env 非法值视为「未配置」而不是挡死启动（与另三侧同口径）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-bad-"));
    try {
      for (const bad of ["not-a-number", "", "70000", "0", "-1"]) {
        fs.writeFileSync(path.join(tmp, ".env"), `COMFYAPP_PORT=${bad}\n`, "utf8");
        expect(readEnvPort(tmp), `COMFYAPP_PORT=${bad}`).toBeNull();
        expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("端口值必须整串是整数：Number.parseInt 吃前缀的那几格与另三侧同判「未配置」（ISSUE #1941）", () => {
    // 根因：`Number.parseInt("3100abc")` === 3100（它只吃到第一个非数字就停），
    // 于是 Node 侧把 `COMFYAPP_PORT=3100abc` 当成用户写死了 3100，而 Python
    // `int()` / Rust `parse::<u16>()` / PowerShell `[int]::TryParse` 对同一个值
    // 给的是「未配置」。两边按不同端口启动：Node 在 3100 起 dev server，壳按路径
    // 推导去等另一个端口 —— ISSUE #821 那个「启动页一直等 dev server」的同一个失效。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-port-prefix-"));
    try {
      for (const bad of ["3100abc", "3100.5", "0x0C4C", "3100abc3100"]) {
        fs.writeFileSync(tmp + "/.env", `COMFYAPP_PORT=${bad}\n`, "utf8");
        expect(readEnvPort(tmp), `COMFYAPP_PORT=${bad}`).toBeNull();
        // 「未配置」的落点是退回路径推导，不是兜底 3100 —— 否则多检出会撞同一个端口。
        expect(resolveAppPort(tmp)).toBe(derivePortFromPath(tmp));
      }
      // 前导 `+` 必须**收**：Rust / PowerShell / Python 三侧都认（ISSUE #1941）。
      // 这一格以前 Node 侧也是 null —— 不收就是新的一处四侧分叉。
      for (const ok of ["+3100", "  +3100  ", "  3100  "]) {
        fs.writeFileSync(tmp + "/.env", `COMFYAPP_PORT=${ok}\n`, "utf8");
        expect(readEnvPort(tmp), `COMFYAPP_PORT=${ok}`).toBe(3100);
      }
      // Unicode 数字位不算：只有 Python 的 `int()` 会收，另三侧都不收。
      fs.writeFileSync(tmp + "/.env", "COMFYAPP_PORT=\u0663\u0661\u0660\u0660\n", "utf8");
      expect(readEnvPort(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it(".env 缺失时按路径推导而不是撞默认端口（多检出并行的前提）", () => {
    const missing = path.join(os.tmpdir(), "definitely-not-existing-checkout");
    expect(readEnvPort(missing)).toBeNull();
    expect(resolveAppPort(missing)).toBe(derivePortFromPath(missing));
    expect(FALLBACK_PORT).toBe(3100);
  });
});

/**
 * 四语言端口一致性：共享校验向量（ISSUE #489 缺陷 4）。
 *
 * 背景：`changelog.d` 与规范 §1.1 都承诺「Node / PowerShell / Python / Rust 四侧
 * 对同一路径给出同一端口」，但此前四侧各写各的固定断言（且 Node 侧只锁了一个
 * 路径），没有任何测试会发现某一侧漂移 —— 例如实测发现 Rust 的
 * `normalize_root_for_port` 完全不做路径解析，Node/Python/PowerShell 对**相对
 * 路径**会拼 cwd，于是 `rel/p` 四侧端口不同。对绝对路径（真实检出的形态）
 * 不影响，但「四侧一致」当时只是文档承诺，不是可失败断言。
 *
 * 这里把向量集中到 `tests/fixtures/app-port-vectors.json`，四侧测试读**同一份**
 * 文件：Node（本文件）、PowerShell / Python / Rust 各自断言同一批 input→port。
 * 任一侧实现漂移 → 对应侧测试失败，而不是等到 Windows 真机上才发现。
 */
describe("app-port 四语言共享校验向量", () => {
  const fixture = /* SAFETY: 类型断言已复核 */ JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "app-port-vectors.json"), "utf8"),
  ) as {
    vectors: Array<{
      input: string;
      normalized: string;
      fnv1a32: number;
      port: number;
    }>;
  };

  it("向量文件非空（防止误删后测试静默全绿）", () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(5);
  });

  it("每个向量：Node 侧规范化 / 哈希 / 端口三者一致", () => {
    for (const v of fixture.vectors) {
      expect(normalizeRootForPort(v.input)).toBe(v.normalized);
      expect(fnv1a32(v.normalized)).toBe(v.fnv1a32);
      expect(derivePortFromPath(v.input)).toBe(v.port);
    }
  });

  it("同一检出的书写差异（分隔符 / 大小写 / 尾斜杠）归一到同一端口", () => {
    // F:\… 与 F:/… 与 F:/…/ 三条向量必须同端口 —— 这正是 §1.1 的承诺。
    const win = fixture.vectors.filter((v) => v.normalized === "f:/ai/other/comfy-app-t3-branch");
    expect(win.length).toBeGreaterThanOrEqual(3);
    expect(new Set(win.map((v) => v.port)).size).toBe(1);
  });
});

/**
 * 仓库根取值的单一来源（ISSUE #1771）。
 *
 * 端口按「检出路径」推导，而「检出路径取哪个」是端口契约的另一半：同一份
 * `resolveAppPort` 喂进两种口径的根（`import.meta.url` 锚定的仓库根 vs
 * `process.cwd()`）在宿主 chdir 之后会给出**不同端口且不报错**。
 * `resolveRepoRoot()` 是那个事实的唯一出口，调用点不得再自算。
 */
describe("仓库根收口（resolveRepoRoot）", () => {
  it("锚在自己的文件位置，不是调用进程的 cwd", () => {
    // 判据是「不随 cwd 走」：cwd 改到别处也必须给出同一个根 —— 那正是
    // `process.cwd()` 口径做不到的一格（也是它迟早分叉的机制）。
    const root = resolveRepoRoot();
    const previous = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(resolveRepoRoot()).toBe(root);
    } finally {
      process.chdir(previous);
    }
    // 本文件在仓库根的 `tests/` 下，于是根必须是它的上一级。
    expect(root).toBe(path.resolve(import.meta.dirname, ".."));
  });

  it("同一份根喂进 resolveAppPort：与显式传仓库根同值", () => {
    expect(resolveAppPort(resolveRepoRoot())).toBe(
      resolveAppPort(path.resolve(import.meta.dirname, "..")),
    );
  });

  it("调用点不得再用 `process.cwd()` 当端口根（防回潮）", () => {
    /* 这一条拦的是「同一事实两处表达」再长出来：两个 e2e 侧调用点此前写的
     * `resolveAppPort(process.cwd())` 就属于这一类 —— 当下与仓库根同值，
     * 换个人从别处 import、或宿主先 chdir 就分叉。判据按形状扫全库，
     * 新增调用点自动落在判据内。 */
    /* `install-git-hooks.mjs` 刻意不在此列：它是 `postinstall` 入口，
     * 而 postinstall 可能在**部分树**（tarball 解包）里跑 —— 那时
     * `app-port.mjs` 未必在场，所以它必须自带根定位、不得长模块依赖
     * （判据：`tests/postinstall-cross-platform.test.ts` 的「真跑」两例）。
     * 也就是说它是「同值但**必须**独立表达」，不是被本条收的那一类。 */
    const callSites = [
      "playwright.config.ts",
      "e2e/global-setup.ts",
      "scripts/e2e-run.mjs",
      "scripts/dev.mjs",
      "scripts/start.mjs",
      "scripts/dev-launcher.mjs",
      "scripts/storybook.mjs",
    ];
    for (const rel of callSites) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src, `${rel} 里 resolveAppPort 的根应来自 resolveRepoRoot()`).not.toMatch(
        /resolveAppPort(?:WithSource)?\(\s*process\.cwd\(\)/,
      );
    }
  });
});

describe("parseDotEnvPortValue：整串是十进制整数才算端口（四侧同口径）", () => {
  it("吃前缀的几格全部判 null（Node 侧曾是唯一把它们读成端口的那一侧）", () => {
    expect(parseDotEnvPortValue("3100abc")).toBeNull();
    expect(parseDotEnvPortValue("3100.5")).toBeNull();
    expect(parseDotEnvPortValue("0x0C4C")).toBeNull();
    expect(parseDotEnvPortValue("3100abc3100")).toBeNull();
    expect(parseDotEnvPortValue("")).toBeNull();
    expect(parseDotEnvPortValue(null)).toBeNull();
    // Unicode 数字位：`\\d` 在 JS 里不含它们，正好与 Rust / PowerShell 一致
    // （Python 的 `int()` 是唯一收的那一侧，由向量与它的自检负责）。
    expect(parseDotEnvPortValue("\u0663\u0661\u0660\u0660")).toBeNull();
  });

  it("前导 `+` 与前尾空白都收（Rust / PowerShell / Python 三侧同判）", () => {
    expect(parseDotEnvPortValue("+3100")).toBe(3100);
    expect(parseDotEnvPortValue("  +3100  ")).toBe(3100);
    expect(parseDotEnvPortValue("  3100  ")).toBe(3100);
    // 但「两个加号」与「加号后有空白」不是数字。
    expect(parseDotEnvPortValue("++3100")).toBeNull();
    expect(parseDotEnvPortValue("+ 3100")).toBeNull();
  });

  it("落点 1..=65535，越界按未配置", () => {
    expect(parseDotEnvPortValue("1")).toBe(1);
    expect(parseDotEnvPortValue("65535")).toBe(65535);
    expect(parseDotEnvPortValue("0")).toBeNull();
    expect(parseDotEnvPortValue("-1")).toBeNull();
    expect(parseDotEnvPortValue("65536")).toBeNull();
    expect(parseDotEnvPortValue("99999")).toBeNull();
  });
});
