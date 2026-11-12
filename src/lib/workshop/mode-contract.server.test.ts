/**
 * 模式契约读取的判据（ISSUE #1901 / #1917 / #3396 / #3603 / #3634）。
 *
 * 这一层的题目是**几层来源怎么合**：成品配置（项目默认基线）、本机覆盖
 * （`data/workshop-mode-contracts.json`）与生效注册表。各钉一件事——
 *
 *   ① 没有覆盖文件时读到的是成品配置（不是空数组 —— 「没配过」与「没有契约」
 *      是两件事，混淆会让工坊对每个模式的对外口都变成空清单）；
 *   ② 覆盖存在且非空时**逐模式**压过成品配置（其余模式仍读成品配置那份 ——
 *      覆盖存的是**差集**，拿它整份替换注册表会让其余模式回落推导）；
 *   ③ 覆盖是**空数组**时回落成品配置：`[]` 是「这本机没改过」的状态本身；
 *   ④ 老检出（契约曾存在入库的 `config/`）升级后不丢配置：老文件在、覆盖不在时
 *      读它，且读路径只读不搬；
 *   ⑤ 坏 JSON / 读不出来不是静默的：按「没有覆盖」处理，回落成品配置；
 *   ⑥ 写失败抛出带路径的错误（「保存了但没落盘」是最坏的形态，它唯一的痕迹
 *      就是这一句）；
 *   ⑦ 项目默认**现读磁盘**（#3634）：写完那份文件立刻生效，不必重启进程；
 *   ⑧ 「保存为项目默认」写出的文件**始终是完整基线**（#3634：此前会把其余
 *      模式的内容抹掉，文件里只剩编辑器发来的那一条）。
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
  loadModeContractLayers,
  loadModeContracts,
  readConfiguredModeContracts,
  resetModeContractOverride,
  saveModeContracts,
  saveModeContractsAsProjectDefaults,
} from "./mode-contract.server";
import {
  MODE_CONTRACTS_REL_PATH,
  MODE_CONTRACT_DEFAULTS_REL_PATH,
} from "./mode-contract-write-path";
import {
  configuredModeContracts,
  derivedModeContract,
  parseModeContracts,
} from "./model-mode-contract";

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

/** 往临时 root 里写一份项目默认基线（`src/lib/workshop/mode-contract-defaults.json`）。 */
async function writeProjectDefaults(contracts: unknown): Promise<string> {
  const file = path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(contracts, null, 2), "utf8");
  return file;
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

  it("覆盖存在且非空时**逐模式**压过成品配置（其余模式仍读成品配置那份）", async () => {
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
    const loaded = await loadModeContracts(root);
    // 归一化在小写模式码上也生效（存进去的键是大写口径）
    expect(loaded.find((c) => c.mode === "T2I")).toEqual({ ...only[0], required: ["prompt"] });
    /* 其余模式**仍在**：覆盖存的是差集（只留真改过的模式），拿它整份替换注册表
     * 会让其余模式回落推导 —— 那正是「编辑器看到 A、工坊跑 B」的分叉。 */
    expect(loaded.length).toBe(configuredModeContracts().length);
    const configured = configuredModeContracts();
    expect(loaded.find((c) => c.mode === "I2I")).toEqual(configured.find((c) => c.mode === "I2I"));
  });

  it("覆盖条目与成品配置内容相同时按「没改过」处理（生效值回落成品配置本身）", async () => {
    const [t2i] = configuredModeContracts(["T2I"]);
    if (!t2i) {
      throw new Error("成品配置里没有 T2I");
    }
    // 存一条与成品配置逐字相同的覆盖 —— 差集化之后它本不该落盘。
    await saveModeContracts([t2i], root);
    await expect(readRaw()).resolves.toBe("[]\n");
    const loaded = await loadModeContracts(root);
    expect(loaded.find((c) => c.mode === "T2I")).toEqual(t2i);
  });

  it("覆盖是空数组时回落成品配置（`[]` = 这本机没改过）", async () => {
    await saveModeContracts([], root);
    await expect(readRaw()).resolves.toBe("[]\n");
    await expect(loadModeContracts(root)).resolves.toEqual(configuredModeContracts());
  });

  it("保存走差集：与成品配置相同的模式不落盘（ISSUE #3396 反馈 1）", async () => {
    // 整份注册表里只有一条真改过（I2I 输出类别），其余原样 —— 落盘的只有那一条。
    const [t2i, i2i] = configuredModeContracts(["T2I", "I2I"]);
    if (!t2i || !i2i) {
      throw new Error("成品配置里没有 T2I / I2I");
    }
    const saved = await saveModeContracts([t2i, { ...i2i, output: "video" }], root);
    expect(saved.map((c) => c.mode)).toEqual(["I2I"]);
    expect(JSON.parse((await readRaw()) ?? "{}")).toEqual(saved);
  });

  it("还原默认：把模式从本机覆盖移除；覆盖不在时不动、不建文件", async () => {
    const [t2i, i2i] = configuredModeContracts(["T2I", "I2I"]);
    if (!t2i || !i2i) {
      throw new Error("成品配置里没有 T2I / I2I");
    }
    await saveModeContracts(
      [
        { ...t2i, output: "video" },
        { ...i2i, output: "video" },
      ],
      root,
    );
    const res = await resetModeContractOverride("T2I", root);
    expect(res.contracts.map((c) => c.mode)).toEqual(["I2I"]);
    // 生效值 = 成品配置那条
    expect(res.effective).toEqual(t2i);
    // 生效注册表：T2I 回落成品配置，I2I 仍是本机覆盖那份
    const loaded = await loadModeContracts(root);
    expect(loaded.find((c) => c.mode === "T2I")).toEqual(t2i);
    expect(loaded.find((c) => c.mode === "I2I")).toEqual({ ...i2i, output: "video" });

    // 覆盖不在时：无事可做、不建文件（读路径无副作用的同一纪律）
    await fs.rm(path.join(root, "data"), { recursive: true, force: true });
    const noop = await resetModeContractOverride("T2I", root);
    expect(noop.contracts).toEqual([]);
    expect(noop.effective).toBeNull();
    await expect(readRaw()).resolves.toBeNull();
  });

  it("老检出（曾落在 config/）升级后不丢配置，且读路径只读不搬", async () => {
    const legacy = await writeLegacy([
      { mode: "I2I", inputs: ["prompt", "first-frame"], output: "image" },
    ]);

    const loaded = await loadModeContracts(root);
    expect(loaded.find((c) => c.mode === "I2I")).toEqual({
      mode: "I2I",
      inputs: ["prompt", "first-frame"],
      output: "image",
    });
    // 其余模式仍在（老覆盖只压它自己那一条）
    expect(loaded.length).toBe(configuredModeContracts().length);
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

describe("项目默认：现读磁盘，不必重启（ISSUE #3634）", () => {
  it("磁盘上那份就是成品配置（写完立刻生效，不需要重启进程）", async () => {
    const tweaked = { ...derivedModeContract("T2I"), output: "video" as const };
    await writeProjectDefaults([tweaked]);

    const configured = await readConfiguredModeContracts(root);
    expect(configured.find((c) => c.mode === "T2I")).toEqual(tweaked);
    // 生效注册表也跟着走（不必重启就能读到新口径）
    const loaded = await loadModeContracts(root);
    expect(loaded.find((c) => c.mode === "T2I")).toEqual(tweaked);
  });

  it("文件不在时回落编译进包的那份（桌包载荷里没有源码）", async () => {
    await expect(readConfiguredModeContracts(root)).resolves.toEqual(configuredModeContracts());
  });

  it("文件是坏 JSON / 不是数组时回落编译进包的那份（坏文件不该打成 500）", async () => {
    await writeProjectDefaults({ 这不是: "注册表" });
    await expect(readConfiguredModeContracts(root)).resolves.toEqual(configuredModeContracts());
  });

  it("三层一次读完：成品配置 / 本机覆盖 / 生效注册表", async () => {
    const tweaked = { ...derivedModeContract("T2I"), output: "video" as const };
    await writeProjectDefaults([tweaked]);
    await saveModeContracts([{ ...derivedModeContract("I2I"), output: "audio" as const }], root);
    const layers = await loadModeContractLayers(root);
    expect(layers.configured.find((c) => c.mode === "T2I")).toEqual(tweaked);
    expect(layers.override.map((c) => c.mode)).toEqual(["I2I"]);
    expect(layers.contracts.find((c) => c.mode === "T2I")).toEqual(tweaked);
    expect(layers.contracts.find((c) => c.mode === "I2I")?.output).toBe("audio");
  });
});

describe("保存为项目默认：开发检出的写回入口（ISSUE #3396 / #3634）", () => {
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

  it("全量落盘（#3603）：编辑器现状逐模式写入，required 固化成自描述基线", async () => {
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
    /* 全量语义：写出去的是**完整基线** —— 编辑器给的那三条原样落盘，其余生成类
     * 模式由成品配置补齐（成品配置那份这时也在这台机器上，所以基线不缺模式）。 */
    expect(res.contracts.map((c) => c.mode)).toContain("T2I");
    expect(res.contracts.map((c) => c.mode)).toContain("I2I");
    expect(res.contracts.map((c) => c.mode)).toContain("T2A");
    expect(res.contracts).toHaveLength(configuredModeContracts().length);
    // required 固化：显式数组，哪怕与内置默认相同也写出来。
    for (const contract of res.contracts) {
      expect(Array.isArray(contract.required), contract.mode).toBe(true);
    }
    const raw = await fs.readFile(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH), "utf8");
    expect(JSON.parse(raw)).toEqual(res.contracts);
    // 落点就是入库的那一份（跟代码走的文件）
    expect(res.file).toBe(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH));
  });

  it("写出的文件始终是完整基线：其余模式的内容不消失（#3634）", async () => {
    await asDevCheckout();
    /* 先在本机覆盖里改一条（模拟「这台机器上改过」）—— 此前正是这条覆盖让
     * 「保存为项目默认」只写得出被改过的那一项，其余模式的内容全被抹掉。 */
    await saveModeContracts([{ ...derivedModeContract("T2I"), output: "video" }], root);
    const effective = await loadModeContracts(root);
    await saveModeContractsAsProjectDefaults(effective, root);

    const raw = await fs.readFile(path.join(root, MODE_CONTRACT_DEFAULTS_REL_PATH), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const written = parseModeContracts(parsed);
    expect(written).toHaveLength(configuredModeContracts().length);
    for (const contract of configuredModeContracts()) {
      expect(written.map((c) => c.mode)).toContain(contract.mode);
    }
    // 写完之后读取侧现读磁盘：生效值立刻是新基线，不必重启。
    const reloaded = await loadModeContracts(root);
    expect(reloaded.find((c) => c.mode === "T2I")?.output).toBe("video");
  });
});
