/**
 * 模式契约注册表**三层**的判据（ISSUE #3396 / #3634）。
 *
 * 这一层是纯函数（不碰文件、不碰网络），价值全在「怎么合」与「怎么算差集」：
 *
 *   · `mergeModeContracts` —— 逐模式把本机覆盖压过成品配置；覆盖里内容与成品
 *     配置相同的那条按「没改过」处理；覆盖里有、成品配置里没有的模式不丢。
 *   · `localOverrideDiff` —— 本机覆盖该写进 `data/` 的内容（与成品配置有差异
 *     的那些）；基准可注入（服务端传的是**现读**的项目默认基线）。
 */
import { describe, expect, it } from "vitest";

import { localOverrideDiff, mergeModeContracts } from "./mode-contract-registry";
import {
  configuredModeContracts,
  derivedModeContract,
  modeContractSignature,
  parseModeContracts,
  type ModeContract,
} from "./model-mode-contract";

describe("mergeModeContracts：成品配置 + 本机覆盖 = 生效注册表", () => {
  const configured = configuredModeContracts(["T2I", "I2I"]);

  it("覆盖逐模式压过成品配置（其余模式不受影响）", () => {
    const merged = mergeModeContracts(configured, [
      { mode: "T2I", inputs: ["prompt"], output: "image", required: ["prompt"] },
    ]);
    expect(merged.find((c) => c.mode === "T2I")?.inputs).toEqual(["prompt"]);
    expect(merged.find((c) => c.mode === "I2I")).toEqual(configured.find((c) => c.mode === "I2I"));
    expect(merged).toHaveLength(2);
  });

  it("覆盖条目与成品配置内容相同时按「没改过」处理（生效值回落成品配置本身）", () => {
    const merged = mergeModeContracts(configured, [configured[0]!]);
    expect(merged.find((c) => c.mode === "T2I")).toEqual(configured[0]);
  });

  it("覆盖里有、成品配置里没有的模式不丢（追加在后面）", () => {
    const merged = mergeModeContracts(configured, [
      { mode: "XXX", inputs: ["prompt"], output: "image" },
    ]);
    expect(merged.map((c) => c.mode)).toEqual(["T2I", "I2I", "XXX"]);
  });

  it("模式码大小写不敏感（注册表按大写存）", () => {
    const merged = mergeModeContracts(configured, [
      { mode: "t2i", inputs: ["prompt"], output: "image" },
    ]);
    expect(merged.find((c) => c.mode === "T2I")?.inputs).toEqual(["prompt"]);
  });
});

describe("localOverrideDiff：本机覆盖只落真改过的模式", () => {
  it("与成品配置相同的模式不落盘，其余落盘", () => {
    const configured = configuredModeContracts(["T2I", "I2I"]);
    const diff = localOverrideDiff(
      [configured[0]!, { ...configured[1]!, output: "video" }],
      configured,
    );
    expect(diff.map((c) => c.mode)).toEqual(["I2I"]);
  });

  it("基准可注入（服务端传的是现读的项目默认基线，不是编译快照）", () => {
    const live: Array<ModeContract> = [{ mode: "T2I", inputs: ["prompt"], output: "video" }];
    // 与「现读基线」相同 ⇒ 不落盘；与「编译快照」不同 ⇒ 落盘。
    expect(localOverrideDiff(live, live)).toEqual([]);
    expect(localOverrideDiff(live, configuredModeContracts(["T2I"])).map((c) => c.mode)).toEqual([
      "T2I",
    ]);
  });

  it("required 未固化与固化后的内置默认是同一件事（不因此算改过）", () => {
    const t2i = derivedModeContract("T2I");
    const diff = localOverrideDiff([{ ...t2i, required: undefined }], [t2i]);
    expect(diff).toEqual([]);
  });
});

describe("modeContractSignature：比较键与来源无关（#3634）", () => {
  it("键序不同不算「改过」（落盘那份与编辑器草稿那份字段顺序可能不同）", () => {
    const a: ModeContract = { mode: "T2I", inputs: ["prompt"], output: "image" };
    // 同一份契约的另一种写法：字段顺序换了、required 显式写了出来。
    const b: ModeContract = {
      output: "image",
      required: ["prompt"],
      mode: "T2I",
      inputs: ["prompt"],
    };
    expect(modeContractSignature(a)).toBe(modeContractSignature(b));
  });

  it("自定义口定义那一项的键序不同也不算「改过」", () => {
    const a: ModeContract = {
      mode: "T2I",
      inputs: ["prompt", "custom-text-1"],
      output: "image",
      customInputs: [{ id: "custom-text-1", label: "画风", kind: "text" }],
    };
    const b: ModeContract = {
      mode: "T2I",
      inputs: ["prompt", "custom-text-1"],
      output: "image",
      customInputs: [{ kind: "text", id: "custom-text-1", label: "画风" }],
    };
    expect(modeContractSignature(a)).toBe(modeContractSignature(b));
  });

  it("内容不同才算改过（口清单少一条就不同）", () => {
    const a = parseModeContracts([{ mode: "T2I", inputs: ["prompt"], output: "image" }]);
    const b = parseModeContracts([{ mode: "T2I", inputs: ["prompt", "size"], output: "image" }]);
    expect(modeContractSignature(a[0]!)).not.toBe(modeContractSignature(b[0]!));
  });
});
