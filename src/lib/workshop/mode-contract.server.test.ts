/**
 * 模式契约读取的判据（ISSUE #1901 / #1917）。
 *
 * 这一层的题目是**两份来源怎么合**：成品配置（编译进源码的那份）给默认，
 * 本机覆盖（`data/workshop-mode-contracts.json`）在这台机器上压过它。六条用例
 * 各钉一件事——
 *
 *   ① 没有覆盖文件时读到的是成品配置（不是空数组 —— 「没配过」与「没有契约」
 *      是两件事，混淆会让工坊对每个模式的对外口都变成空清单）；
 *   ② 覆盖存在且非空时整份压过成品配置（含「成品配置里删掉的模式不许被覆盖
 *      复活」这条方向）；
 *   ③ 覆盖是**空数组**时回落成品配置：`[]` 是「这本机没改过」的状态本身；
 *   ④ 老检出（契约曾存在入库的 `config/`）升级后不丢配置：老文件在、覆盖不在时
 *      读它，且读路径只读不搬；
 *   ⑤ 坏 JSON / 读不出来不是静默的：按「没有覆盖」处理，回落成品配置；
 *   ⑥ 写失败抛出带路径的错误（「保存了但没落盘」是最坏的形态，它唯一的痕迹
 *      就是这一句）。
 *
 * 这里**真读写临时目录**（不 mock fs）：这一层的全部价值就是「读到了哪一份、
 * 内容有没有被归一化」——桩掉 fs 之后这两件都判不出来。`root` 参数就是为它留的。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isDevCheckout,
  loadModeContracts,
  saveModeContracts,
  saveModeContractsAsProjectDefaults,
} from "./mode-contract.server";
import {
  MODE_CONTRACTS_REL_PATH,
  MODE_CONTRACT_DEFAULTS_REL_PATH,
} from "./mode-contract-write-path";
import { configuredModeContracts, derivedModeContract } from "./model-mode-contract";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "mode-contracts-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** 读覆盖那份文件的原始文本（不存在返回 null）。 */
async function readRaw(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, MODE_CONTRACTS_REL_PATH), "utf8");
  } catch {
    return null;
  }
}

/** 造一份「老检出」的文件（契约曾落在入库的 `config/` 里）。 */
async function writeLegacy(contracts: unknown): Promise<string> {
  const legacy = path.join(root, "config", "workshop-mode-contracts.json");
  await fs.mkdir(path.dirname(legacy), { recursive: true });
  await fs.writeFile(legacy, JSON.stringify(contracts), "utf8");
  return legacy;
}

describe("模式契约：成品配置 + 本机覆盖", () => {
  it("覆盖落在本机运行期目录 data/，不是入库的项目配置 config/", () => {
    expect(MODE_CONTRACTS_REL_PATH).toBe("data/workshop-mode-contracts.json");
    // 这条是这次改动的**本意**：`config/` 那一层已删（ISSUE #1917）——
    // 内置默认改成源码里的成品配置，机器上的改动只落在本机。
    expect(MODE_CONTRACTS_REL_PATH.startsWith("config/")).toBe(false);
    expect(MODE_CONTRACTS_REL_PATH.startsWith("data/")).toBe(true);
  });

  it("没有覆盖文件时读到的是成品配置（不是空数组）", async () => {
    const contracts = await loadModeContracts(root);
    expect(contracts).toEqual(configuredModeContracts());
    // 反向对照：这一条不是恒真 —— 成品配置确实有内容，且覆盖文件确实没被建出来。
    // 「读一次写一次」会把「看一眼」事故性地固化成这台机器的覆盖。
    expect(contracts.length).toBeGreaterThan(0);
    await expect(readRaw()).resolves.toBeNull();
  });

  it("覆盖存在且非空时整份压过成品配置（成品里删掉的模式不许被老覆盖复活）", async () => {
    const only = [{ mode: "T2I", inputs: ["prompt", "size"], output: "image" }];
    await saveModeContracts(
      [
        {
          mode: "t2i",
          inputs: ["prompt", "size"],
          output: "image",
          required: ["prompt"],
        },
      ],
      root,
    );
    // 归一化在小写模式码上也生效（存进去的键是大写口径）
    await expect(loadModeContracts(root)).resolves.toEqual([{ ...only[0], required: ["prompt"] }]);
    // 成品配置里的其它模式**一条都不在**：覆盖是整份替换，不是按模式合并。
    expect((await loadModeContracts(root)).length).toBe(1);
  });

  it("覆盖是空数组时回落成品配置（`[]` = 这本机没改过）", async () => {
    await saveModeContracts([], root);
    await expect(readRaw()).resolves.toBe("[]\n");
    await expect(loadModeContracts(root)).resolves.toEqual(configuredModeContracts());
  });

  it("老检出（曾落在 config/）升级后不丢配置，且读路径只读不搬", async () => {
    const legacy = await writeLegacy([
      { mode: "I2I", inputs: ["prompt", "first-frame"], output: "image" },
    ]);

    await expect(loadModeContracts(root)).resolves.toEqual([
      { mode: "I2I", inputs: ["prompt", "first-frame"], output: "image" },
    ]);
    // 读路径**不**产生副作用：老文件还在，新覆盖也不会被顺手建出来
    //（「读一次写一次」会让一次查看把内容钉进这台机器）。
    await expect(fs.stat(legacy)).resolves.toBeTruthy();
    await expect(readRaw()).resolves.toBeNull();
  });

  it("老检出那份是空数组时回落成品配置（先前的空覆盖不该被后来者继承）", async () => {
    await writeLegacy([]);
    await expect(loadModeContracts(root)).resolves.toEqual(configuredModeContracts());
  });

  it("坏 JSON 按「没有覆盖」处理，不把工坊打成 500", async () => {
    const file = path.join(root, MODE_CONTRACTS_REL_PATH);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ 这不是 JSON", "utf8");
    await expect(loadModeContracts(root)).resolves.toEqual(configuredModeContracts());
  });

  it("写不进去时报错并带上路径（不静默吞掉）", async () => {
    // 让 data 那一段是个**文件**：mkdir / 写都必然失败，模拟只读 / 被占用的目录
    await fs.writeFile(path.join(root, "data"), "占位", "utf8");

    await expect(
      saveModeContracts([{ mode: "T2I", inputs: ["prompt"], output: "image" }], root),
    ).rejects.toThrow(/模式契约写入失败.*workshop-mode-contracts\.json/s);
  });
});

describe("保存为项目默认：开发检出的写回入口（ISSUE #3396）", () => {
  /** 把临时 root 布置成一份「开发检出」：编排器在位 + src 目标目录在。 */
  async function asDevCheckout(): Promise<void> {
    const launcher = path.join(root, "scripts", "dev-launcher.mjs");
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    await fs.writeFile(launcher, "// 桩：形态判据只看它在不在", "utf8");
  }

  it("判据与壳的形态判据同口径：检出里有编排器才是开发检出", async () => {
    expect(isDevCheckout(root)).toBe(false);
    await asDevCheckout();
    expect(isDevCheckout(root)).toBe(true);
  });

  it("非开发检出大声拒绝（正式包没有源码可写，这条调用就是错用）", async () => {
    await expect(
      saveModeContractsAsProjectDefaults(
        [{ mode: "T2I", inputs: ["prompt"], output: "image" }],
        root,
      ),
    ).rejects.toThrow(/只在开发检出可用/);
    // 拒绝的同时什么都没写
    await expect(
      fs.readFile(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH), "utf8"),
    ).rejects.toThrow();
  });

  it("写的是与推导的**差集**，与推导相同的模式不写（未覆盖的继续跟随推导演进）", async () => {
    await asDevCheckout();
    const derivedT2I = derivedModeContract("T2I");
    const tweaked: typeof derivedT2I = {
      ...derivedModeContract("I2I"),
      output: "video",
    };
    const res = await saveModeContractsAsProjectDefaults(
      [derivedT2I, tweaked, derivedModeContract("T2A")],
      root,
    );
    // 与推导相同的 T2I / T2A 被丢掉；I2I（输出类别被改）保留。
    expect(res.contracts.map((c) => c.mode)).toEqual(["I2I"]);
    const raw = await fs.readFile(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH), "utf8");
    expect(JSON.parse(raw)).toEqual(res.contracts);
    // 落点就是入库的那一份（跟代码走的文件）
    expect(res.file).toBe(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH));
  });

  it("全都与推导相同 ⇒ 写出空数组（= 没有任何显式覆盖，读取侧纯推导）", async () => {
    await asDevCheckout();
    const res = await saveModeContractsAsProjectDefaults([derivedModeContract("T2I")], root);
    expect(res.contracts).toEqual([]);
    await expect(
      fs.readFile(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH), "utf8"),
    ).resolves.toBe("[]\n");
  });
});
