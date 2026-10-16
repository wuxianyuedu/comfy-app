/**
 * 「环境前提」那一步的判据（ISSUE #1959）。
 *
 * ## 它守的是哪一格
 *
 * 用户那一句诉求是「**别等到执行几十分钟后才发现环境安装不上**」。缺件那一半已经
 * 由 `工具链自证` / `Python 可用性` 在最便宜的位置答了（判据在
 * `tests/ci-toolchain-selfcheck.test.ts`）。**在，但版本不对**与**配置配错了**这两半
 * 此前没人答，而它们的红法恰好是「晚」：
 *
 *   · 解释器低于本仓下限（Python 3.10）时**没有任何一步会红** —— 门禁的 Python 侧
 *     以「探测不到」的名义退出四侧比对、那几条真跑的用例走 `env` 档跳过并登记，
 *     也就是「版本不对」与「装好了」在日志里**逐字同形**；
 *   · `.cnb.yml` 里写了 host 侧 PowerShell（5.1）认不了的语法（`?.` / `??`）时，
 *     它**不在解析期报错**，只在跑到那一段时整段炸 —— 实测红在 `Install dependencies`，
 *     而那时前面的预算已经花掉了。
 *
 * ## 两处判据都**不重写**（这一条比本文件判什么更要紧）
 *
 *   · 「解释器在哪」走 `ci-toolchain-python.mjs` 的 `findPython()`（与
 *     `Python 可用性` 同一份候选表、同一个探针 —— §12.18 不造第二轮子）；
 *   · 「`.cnb.yml` 有没有 host 认不了的语法」复用
 *     `tests/no-platform-ci-config.test.ts` 导出那一份 `ps7OnlySyntaxIn`。
 *
 * 但那一份是 `.ts`、本步跑在**任何依赖安装之前**（那时 `node_modules` 还没有），
 * 所以 `scripts/ci-env-probe.mjs` 里留了一份**文本副本** —— 与本仓既有的
 * `check-app-port-vectors.cjs` ⇄ `python-candidates.ts` 同一处置（`.cjs` 也 import
 * 不到那份 `.ts`）。本文件第一组用例就是**对账那一份副本**：漂了就红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  envProbe,
  parseVersionTriple,
  ps7OnlySyntaxIn as ps7OnlySyntaxInProbe,
  PYTHON_MIN_TEXT,
  pythonVersionMeetsFloor,
  readPipelineConfig,
} from "../scripts/ci-env-probe.mjs";
import {
  ps7OnlySyntaxIn as ps7OnlySyntaxInGate,
  registeredGateOrder,
} from "./no-platform-ci-config.test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 一份「什么都没有」的假注入面（用例只关心它自己造的那一格）。 */
function silentPorts() {
  return { log: String, logError: String };
}

describe("环境前提：两处判据不许各写一份答案", () => {
  it("`?.` / `??` 那一份表：脚本里的副本与门禁判据逐项同一份答案", () => {
    /* 两份实现的**形状**必然不同（一个给行号、一个给结论），能也**必须**对账的是
     * 「哪些写法算命中」与「替代写法怎么说」。这里按文本造一组现场喂进两边。 */
    const fixture = [
      "a:",
      "  stages:",
      "  - name: x",
      "    script: |",
      "      # 注释里的 ?. 不算（配置里正当地会写出这个形状）",
      "      $a = (Get-Command w) ?.Source",
      "      $b = $c ?? 1",
      "      $d = [List[string]]::new()",
      "      $e = $f | ConvertFrom-Json -AsHashtable",
      "  - name: y",
      "    script: cmd /c ver",
      "",
    ].join("\n");
    const gate = ps7OnlySyntaxInGate(fixture);
    const probe = ps7OnlySyntaxInProbe(fixture);
    /* 两个方向都判：少了 = 扫描面漂了；两边都得**真的命中**（不然这条用例是空转）。 */
    expect(gate.length, "门禁那一份没命中 —— 夹具本身写坏了").toBe(4);
    expect(probe.length, "脚本那一份没命中 —— 副本漂了").toBe(gate.length);
    /* 行号必须指到同一行（差一行就等于有一边扫错了块边界）。 */
    const lineOf = (s: string) => Number(/第 (\d+) 行/.exec(s)?.[1] ?? -1);
    expect(probe.map(lineOf)).toEqual(gate.map(lineOf));
  });

  it("注释与块外的同形文本都放过（不然这条判据会逼人删说明注释）", () => {
    const commented =
      "x:\n  - name: a\n    script: |\n      # 这里正当地写着 ?. 这个形状\n      ok\n";
    expect(ps7OnlySyntaxInProbe(commented)).toEqual([]);
    expect(ps7OnlySyntaxInGate(commented)).toEqual([]);
    expect(ps7OnlySyntaxInProbe("name: ?.\nscript: cmd /c ver\n")).toEqual([]);
  });

  it("现役 `.cnb.yml` 自己就是干净的（这条判据必须真判过那份文件）", () => {
    const text = readPipelineConfig(ROOT);
    expect(text, "读不到仓库根的 .cnb.yml —— 扫描面指错了地方").not.toBeNull();
    expect(ps7OnlySyntaxInProbe(text ?? "")).toEqual([]);
  });
});

describe("环境前提：解释器版本下限（低于下限时没有任何一步会红）", () => {
  it("下限只有一处定义，且与它的话术对得上", () => {
    expect(PYTHON_MIN_TEXT).toBe("3.10");
    /* `scripts/setup-comfy-cli-venv.ps1` 是本仓唯一写明下限的地方 —— 漂了就红。 */
    const venv = read("scripts/setup-comfy-cli-venv.ps1");
    expect(
      venv.includes(PYTHON_MIN_TEXT),
      "`setup-comfy-cli-venv.ps1` 里找不到这条下限 —— 两处漂了",
    ).toBe(true);
  });

  it("三档取值分得开：达标 / 不达标 / 解析不出（「不知道」不是「不达标」）", () => {
    expect(pythonVersionMeetsFloor("Python 3.12.2")).toEqual({
      ok: true,
      triple: [3, 12, 2],
    });
    expect(pythonVersionMeetsFloor("Python 3.10.0").ok).toBe(true);
    expect(pythonVersionMeetsFloor("Python 3.9.13")).toEqual({
      ok: false,
      triple: [3, 9, 13],
    });
    expect(pythonVersionMeetsFloor("Python 2.7.18").ok).toBe(false);
    /* 解析不出时 `triple: null`，调用方据此**只记读数**（与 §13.6.4.1
     * 「拿不到测量 ≠ 测量结果是红的」同一口径）。 */
    expect(pythonVersionMeetsFloor("(没有输出)")).toEqual({
      ok: false,
      triple: null,
    });
    expect(parseVersionTriple("3")).toEqual([3, 0, 0]);
  });
});

describe("环境前提：判定面的两个方向（红了要红在「几秒就能问出来」的位置）", () => {
  /** 一份「解释器达标、pnpm 起得来、配置干净」的注入面。 */
  function greenPorts(overrides: Record<string, unknown> = {}) {
    return {
      root: ROOT,
      findPythonImpl: () => ({
        command: "python",
        path: null,
        version: "Python 3.12.2",
      }),
      runImpl: () => ({ ok: true, out: "12.4.1" }),
      ...silentPorts(),
      ...overrides,
    };
  }

  it("绿侧：前提齐 ⇒ 退 0", () => {
    expect(envProbe(greenPorts())).toBe(0);
  });

  it("红侧：解释器低于下限 ⇒ 非零退出", () => {
    const lines: string[] = [];
    const code = envProbe(
      greenPorts({
        findPythonImpl: () => ({
          command: "python",
          path: null,
          version: "Python 3.9.13",
        }),
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("3.9.13");
    /* 话术里必须给**下一动作**（与 §13.5.3.5.1「红了要红在能指路的位置」同口径）。 */
    expect(lines.join("\n")).toContain("PATH");
  });

  it("红侧：`.cnb.yml` 里出现 host 认不了的语法 ⇒ 非零退出（且能指到那一行）", () => {
    const lines: string[] = [];
    const code = envProbe(
      greenPorts({
        config: [
          "a:",
          "  - name: x",
          "    script: |",
          "      $a = (Get-Command w) ?.Source",
          "",
        ].join("\n"),
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    const said = lines.join("\n");
    expect(said).toContain("第 4 行");
    expect(said).toContain("?.`");
    /* 话术要指路（宿主是 5.1，替代写法是显式 `if`）—— 只说「语法错误」等于把
     * 下一动作又留给人猜。 */
    expect(said).toContain("if ($x)");
  });

  it("红侧：读不到配置也红（它判的就是那份配置，读不到 = 一条都没判）", () => {
    const lines: string[] = [];
    const code = envProbe(
      greenPorts({
        config: null,
        logError: (l: string) => lines.push(l),
      }),
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(".cnb.yml");
  });

  it("读数与判据分得开：探测失败 / 版本解析不出 / pnpm 探不到都**不**退非零", () => {
    expect(
      envProbe(greenPorts({ findPythonImpl: () => null })),
      "「没有解释器」归 Python 可用性 —— 本步不重复判它",
    ).toBe(0);
    expect(
      envProbe(
        greenPorts({
          findPythonImpl: () => ({
            command: "python",
            path: null,
            version: "(没有输出)",
          }),
        }),
      ),
      "版本解析不出 = 不知道，不是不达标",
    ).toBe(0);
    expect(
      envProbe(greenPorts({ runImpl: () => ({ ok: false, out: "" }) })),
      "裸名字起不来 pnpm 是「读数」（形态解析那一份归工具链自证）",
    ).toBe(0);
  });
});

describe("环境前提：流水线上真的在跑它，且排在装依赖之前", () => {
  it("`COMFYAPP_CI_GATES` 里登记了它，且它排在 `Install dependencies` 之前", () => {
    const order = registeredGateOrder(read(".cnb.yml"));
    expect(
      order.length,
      "解析不出 COMFYAPP_CI_GATES —— 键被删了？",
    ).toBeGreaterThan(0);
    const at = order.indexOf("环境前提");
    const depsAt = order.indexOf("Install dependencies");
    expect(
      at,
      "`环境前提` 不在清单里 —— 那一步因此没有任何执行者",
    ).toBeGreaterThan(-1);
    expect(depsAt).toBeGreaterThan(-1);
    expect(
      at,
      "`环境前提` 必须排在 `Install dependencies` 之前：它要答的是「装得成装不成」的" +
        "前提，排在后面 = 那些结论要等装完（或装失败）才看得到",
    ).toBeLessThan(depsAt);
  });

  it("那一步点名的入口真的在盘上（脚本存在而配置没接上 = 这一步白写）", () => {
    const block = /^\s*-\s*name:\s*环境前提\s*$\r?\n\s*script:\s*(\S.*)$/m.exec(
      read(".cnb.yml"),
    )?.[1];
    expect(block, "解析不出「环境前提」那一步的 script").toBeTruthy();
    const entry = String(block)
      .trim()
      .replace(/^node\s+/, "");
    expect(entry).toBe("scripts/ci-env-probe.mjs");
    expect(
      read(entry).length,
      "「环境前提」点名的入口不在盘上",
    ).toBeGreaterThan(0);
  });
});
