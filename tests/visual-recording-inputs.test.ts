/**
 * 页面级像素基线的**录制输入面**必须有显式登记，且每份 spec 都得真的接上判据（§11.8）。
 *
 * 动因（ISSUE #1620 的追问「录的内容如果和返回的内容相关，不同环境很容易就不一样」）：
 * `freezeComfyStats` / `freezeModelOverview` 这类桩是**逐个手写**的，而一份 spec 只会桩
 * 它「知道自己依赖」的那几格。实测一份只桩了 2 格的首页 spec，真实链路上有 **16 个**
 * `/api/**` 请求 —— 其余由「这台机器的 DB / ComfyUI / 日志目录 / 网络」在答。它们**当时
 * 恰好**没进像素（被 mask 遮着、在浮层里），但没人知道是恰好：谁把某块 chrome 挪出 mask
 * 范围、或让某个降级态改成可见，基线就记住了那台机器的现场，而**当场不红**。
 *
 * 运行时那一半在 `e2e/visual/support/page-baseline.ts`（`watchRecordingInputs` +
 * `expectRecordingInputsDeclared`，由 `settle` 收尾调用）。本文件守它**不会静默退化**：
 *   1. **每份 spec 都得接上**：没调 `watchRecordingInputs` 时运行时判的是空集、永远绿 ——
 *      「判据存在」与「判据有执行者」是两件事（§11.8 反复判过的那味药）；
 *   2. **登记表不许消失**：删条目比加条目更容易过 review，而删掉一条等于把那一格重新
 *      交还给「跑它的那台机器」；
 *   3. **每条都写了「靠什么不进像素」**：`masked` / `offScreen` 不是「安全」，是「这一档
 *      不判它」——note 是下一个人判断这次改动有没有把它推进像素的唯一线索。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const VISUAL_DIR = path.join(ROOT, "e2e/visual");
const BASELINE_MODULE = path.join(VISUAL_DIR, "support/page-baseline.ts");

/** 各份 spec 的源码（只读一次）。 */
function specSources(): Array<{ spec: string; source: string }> {
  return readdirSync(VISUAL_DIR)
    .filter((f) => f.endsWith(".visual.spec.ts"))
    .map((f) => ({
      spec: f,
      source: readFileSync(path.join(VISUAL_DIR, f), "utf8"),
    }));
}

const SOURCES = specSources();
const BASELINE_SOURCE = readFileSync(BASELINE_MODULE, "utf8");

describe("录制输入面：每份 spec 都接上判据（§11.8）", () => {
  it("扫描面收到了视觉 spec（不是空数组假装通过）", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it("每份 spec 都在 goto 之前调 watchRecordingInputs", () => {
    const missing = SOURCES.filter(
      ({ source }) => !source.includes("watchRecordingInputs(page)"),
    ).map(({ spec }) => spec);
    expect(
      missing,
      "这些 spec 没接上「录制输入面」判据 —— 没接上时 settle 判的是空集、永远绿：\n" +
        missing.map((s) => `  · e2e/visual/${s}`).join("\n") +
        "\n  接法：在任何 `goto` 之前 `await watchRecordingInputs(page);`。",
    ).toEqual([]);
  });

  it("watchRecordingInputs 出现在每一处 goto 之前（不是只调了一次）", () => {
    const offenders: string[] = [];
    for (const { spec, source } of SOURCES) {
      /* 按出现次数比对：一份 spec 里有几处 `goto`，就该有几处监听。
         只调一次时，后面那些用例的请求面照旧无人看管 —— 而它们**看起来**接了判据。 */
      const gotos = source.match(/page\.goto\(/g)?.length ?? 0;
      const watches =
        source.match(/watchRecordingInputs\(page\)/g)?.length ?? 0;
      if (gotos > watches)
        offenders.push(`${spec}（goto ${gotos} 处，监听 ${watches} 处）`);
    }
    expect(
      offenders,
      "这些 spec 有 goto 没配监听：\n" +
        offenders.map((s) => `  · e2e/visual/${s}`).join("\n"),
    ).toEqual([]);
  });
});

describe("录制输入面：登记表本身（§11.8）", () => {
  /** 从源码里抠出 `RECORDING_INPUT_CONTRACT` 的键（正则够了：对象字面量的键都是字面量）。 */
  function contractKeys(): string[] {
    const block = BASELINE_SOURCE.slice(
      BASELINE_SOURCE.indexOf("export const RECORDING_INPUT_CONTRACT"),
    );
    const body = block.slice(0, block.indexOf("\n};"));
    return [...body.matchAll(/^\s{2}"([^"]+)":\s*\{/gm)].map((m) => m[1] ?? "");
  }

  it("登记表不是空的（不是把判据改成放行的形态）", () => {
    expect(contractKeys().length).toBeGreaterThan(0);
  });

  it("已知的机器相关数据源都在表里（删条目 = 把那一格交还给机器）", () => {
    /* 这几条是**实测**出来的：它们都由「跑它的那台机器」在答，且都已发生过真事故
       （`model.configList` = #1593 的 4652 像素；`/api/production` = 画布多两个节点）。
       钉住它们是为了让「删一条登记」这件事不能在 review 里悄悄过掉。 */
    const pinned = [
      "/api/comfy/stats",
      "model.configList",
      "/api/production",
      "model.list",
      "project.list",
      "workflow.list",
      "workflowModel.list",
    ];
    const keys = contractKeys();
    const missing = pinned.filter((k) => !keys.includes(k));
    expect(
      missing,
      "这些数据源从登记表里消失了（它们曾由跑它的那台机器在答）：\n" +
        missing.map((k) => `  · ${k}`).join("\n"),
    ).toEqual([]);
  });

  it("每条都写了处置与理由（note 不能是「稍后处理」）", () => {
    const block = BASELINE_SOURCE.slice(
      BASELINE_SOURCE.indexOf("export const RECORDING_INPUT_CONTRACT"),
    );
    const body = block.slice(0, block.indexOf("\n};"));
    /* 逐条抠出 `how` 与 `note`：两个字段都必须存在、note 得写够长（一句「稍后看图」
       会通过长度下限，但过不了「它靠什么不进像素」这条语义 —— 那条给人读，机器只兜底）。 */
    const entries = [...body.matchAll(/^\s{2}"([^"]+)":\s*\{([^}]*)\}/gms)].map(
      (m) => ({ key: m[1] ?? "", fields: m[2] ?? "" }),
    );
    expect(entries.length).toBeGreaterThan(0);
    const bad = entries
      .filter(({ fields }) => {
        const how = /how:\s*"(pinned|masked|offScreen)"/.exec(fields)?.[1];
        const note = /note:\s*"([^"]*)"/.exec(fields)?.[1] ?? "";
        return !how || note.length < 12;
      })
      .map(({ key }) => key);
    expect(
      bad,
      "这些条目的 how / note 不合格（note 要写清**靠什么**不进像素）：\n" +
        bad.map((k) => `  · ${k}`).join("\n"),
    ).toEqual([]);
  });
});
