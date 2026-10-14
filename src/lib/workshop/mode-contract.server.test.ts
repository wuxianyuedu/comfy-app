/**
 * 模式契约注册表的落盘判据（ISSUE #1901）。
 *
 * 这一层的题目是**落点**：契约是项目配置（入库、随包、每个检出同一份），而不是
 * 某一台机器的运行期状态。三条用例各钉一件事——
 *
 *   ① 读写落在 `config/workshop-mode-contracts.json`，且**路径只有一处定义**
 *      （视图层给用户看的保存提示也用它）；
 *   ② 老检出（契约曾存在 `data/` 本机目录）升级后**不丢配置**：新文件不在时读老文件，
 *      且读路径只读不搬（不产生副作用）；
 *   ③ 坏文件 / 写不进去都不是静默的：坏 JSON 回落内置默认，写失败抛出带路径的错误
 *      （桌包安装目录不可写时就靠这一句，否则「保存了但没落盘」没有任何痕迹）。
 *
 * 这里**真读写临时目录**（不 mock fs）：这一层的全部价值就是「文件到底落在哪、
 * 内容有没有被归一化」——桩掉 fs 之后这两件都判不出来。`root` 参数就是为它留的。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadModeContracts, saveModeContracts } from "./mode-contract.server";
import { MODE_CONTRACTS_REL_PATH } from "./mode-contract-file";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "mode-contracts-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** 读新落点那份文件的原始文本（不存在返回 null）。 */
async function readRaw(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, MODE_CONTRACTS_REL_PATH), "utf8");
  } catch {
    return null;
  }
}

describe("模式契约：落在入库的项目配置里", () => {
  it("落点是 config 下的项目配置，不是 data/ 那条本机目录", () => {
    expect(MODE_CONTRACTS_REL_PATH).toBe("config/workshop-mode-contracts.json");
    expect(MODE_CONTRACTS_REL_PATH.startsWith("config/")).toBe(true);
    // 这条是这次改动的**本意**：`data/` 被 .gitignore 忽略、且被分发产物剥离，
    // 放在那里的契约到不了别的检出。
    expect(MODE_CONTRACTS_REL_PATH.startsWith("data/")).toBe(false);
  });

  it("保存 → 读回：写进新落点，且内容是归一化之后的（含换行结尾）", async () => {
    const saved = await saveModeContracts(
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
    expect(saved.map((c) => c.mode)).toEqual(["T2I"]);

    const raw = await readRaw();
    expect(raw, "没写进 config/workshop-mode-contracts.json").not.toBeNull();
    expect(JSON.parse(raw ?? "[]")).toEqual([
      {
        mode: "T2I",
        inputs: ["prompt", "size"],
        output: "image",
        required: ["prompt"],
      },
    ]);
    // 文件以单个换行收尾（避免每次保存产生「无内容差异」的 diff 噪声）
    expect(String(raw).endsWith("\n")).toBe(true);

    await expect(loadModeContracts(root)).resolves.toEqual(saved);
  });

  it("坏 JSON 按「没配过」处理，不把工坊打成 500", async () => {
    const file = path.join(root, MODE_CONTRACTS_REL_PATH);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ 这不是 JSON", "utf8");
    await expect(loadModeContracts(root)).resolves.toEqual([]);
  });

  it("新落点不在时回落老检出那份（data/），且只读不搬", async () => {
    const legacy = path.join(root, "data", "workshop-mode-contracts.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify([
        { mode: "I2I", inputs: ["prompt", "first-frame"], output: "image" },
      ]),
      "utf8",
    );

    await expect(loadModeContracts(root)).resolves.toEqual([
      { mode: "I2I", inputs: ["prompt", "first-frame"], output: "image" },
    ]);
    // 读路径**不**产生副作用：老文件还在，新文件也不会被顺手建出来
    // （「读一次写一次」会让一次查看事故性地把本机配置固化成入库文件）。
    await expect(readRaw()).resolves.toBeNull();
  });

  it("新落点一旦存在就只认它（老文件里更旧的副本不许复活）", async () => {
    const legacy = path.join(root, "data", "workshop-mode-contracts.json");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(
      legacy,
      JSON.stringify([
        { mode: "I2I", inputs: ["prompt", "first-frame"], output: "image" },
      ]),
      "utf8",
    );
    // 空数组 = 用户把定制全清了。这不是「没配过」，必须原样读回空，
    // 否则删掉的配置会被老文件复活。
    await saveModeContracts([], root);

    await expect(loadModeContracts(root)).resolves.toEqual([]);
  });

  it("写不进去时报错并带上路径（不静默吞掉）", async () => {
    // 让 config 那一段是个**文件**：mkdir/写都必然失败，模拟只读 / 被占用的安装目录
    await fs.writeFile(path.join(root, "config"), "占位", "utf8");

    await expect(
      saveModeContracts(
        [{ mode: "T2I", inputs: ["prompt"], output: "image" }],
        root,
      ),
    ).rejects.toThrow(/模式契约写入失败.*workshop-mode-contracts\.json/s);
  });
});
