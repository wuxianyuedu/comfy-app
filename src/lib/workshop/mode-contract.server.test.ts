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

import { loadModeContracts, saveModeContracts } from "./mode-contract.server";
import { MODE_CONTRACTS_REL_PATH } from "./mode-contract-write-path";
import { configuredModeContracts } from "./model-mode-contract";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "mode-contracts-"));
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
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
    const only = [{ inputs: ["prompt", "size"], mode: "T2I", output: "image" }];
    await saveModeContracts(
      [
        {
          inputs: ["prompt", "size"],
          mode: "t2i",
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
      { inputs: ["prompt", "first-frame"], mode: "I2I", output: "image" },
    ]);

    await expect(loadModeContracts(root)).resolves.toEqual([
      { inputs: ["prompt", "first-frame"], mode: "I2I", output: "image" },
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
      saveModeContracts([{ inputs: ["prompt"], mode: "T2I", output: "image" }], root),
    ).rejects.toThrow(/模式契约写入失败.*workshop-mode-contracts\.json/s);
  });
});
