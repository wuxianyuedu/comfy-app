// `preparePortraitReferences` 单测：定妆照 → 镜头生图参考图的收集与上传。
//
// 流程口径（docs/guides/feature-workshop-flow.md §4）：定妆照是后续分镜图的
// 参考图基准。helper 的职责边界：只收集「已选定定妆照」的角色、按镜头的
// 角色出场序排序、上传进 ComfyUI 输入目录换文件名、单张失败不拖垮整批、
// 同一 URL 会话内只上传一次（批量生成不再为同一张图反复落盘）。
// 这里不 mock 本模块，直接 mock 全局 fetch（prepareLocalInputImage 的传输层），
// 上传解析逻辑保持真实执行。
import { afterEach, describe, expect, it, vi } from "vitest";

import { preparePortraitReferences } from "./generation-client";
import type { Character } from "./types";

function makeCharacter(id: string, portraitUrl?: string): Character {
  return {
    id,
    name: `角色${id}`,
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "a cat",
    negativePrompt: "",
    params: {},
    ...(portraitUrl ? { portraitUrl } : {}),
  };
}

/** 桩掉 /api/workshop-local/prepare：按请求体里的图 URL 派生文件名
 *  （…/a.png → up-a.png），`failUrls` 里的 URL 一律失败。
 *  文件名与 URL 绑定而不是与调用序绑定，「出场序」的断言才有意义；
 *  各用例用独立 URL 前缀，避免 helper 的会话内缓存跨用例串味。 */
function mockPrepare(
  prefix: string,
  failUrls: ReadonlySet<string> = new Set(),
) {
  const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(raw) as { image?: string };
    const image = body.image ?? "";
    if (failUrls.has(image)) {
      return new Response(JSON.stringify({ error: "上传失败" }), {
        status: 500,
      });
    }
    const tail = image.split("/").pop() ?? "x";
    return new Response(JSON.stringify({ filename: `up-${prefix}-${tail}` }), {
      status: 200,
    });
  });
  globalThis.fetch = mock;
  return mock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preparePortraitReferences", () => {
  it("按镜头的角色出场序收集已选定妆照，逐张上传换文件名", async () => {
    const characters = [
      makeCharacter("c1", "/api/generated/t1/a.png"),
      makeCharacter("c2"), // 没选定妆照 → 跳过
      makeCharacter("c3", "/api/generated/t1/b.png"),
    ];
    const mock = mockPrepare("t1");

    const { files, failedCount } = await preparePortraitReferences(characters, [
      "c3",
      "c2",
      "c1",
    ]);

    // 出场序（c3 在前），不是角色表序；文件名与 URL 绑定可判序。
    expect(files).toEqual(["up-t1-b.png", "up-t1-a.png"]);
    expect(failedCount).toBe(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("没有角色选定妆照：空数组且不发任何请求", async () => {
    const mock = mockPrepare("t2");
    const { files, failedCount } = await preparePortraitReferences(
      [makeCharacter("c1"), makeCharacter("c2")],
      ["c1", "c2"],
    );
    expect(files).toEqual([]);
    expect(failedCount).toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });

  it("单张上传失败不拖垮整批：计入 failedCount，其余照常返回", async () => {
    const characters = [
      makeCharacter("c1", "/api/generated/t3/a.png"),
      makeCharacter("c2", "/api/generated/t3/b.png"),
    ];
    mockPrepare("t3", new Set(["/api/generated/t3/a.png"]));

    const { files, failedCount } = await preparePortraitReferences(characters, [
      "c1",
      "c2",
    ]);

    expect(files).toEqual(["up-t3-b.png"]);
    expect(failedCount).toBe(1);
  });

  it("内置默认契约只有两个参考图槽：超过两张的定妆照不做无效上传", async () => {
    const characters = [
      makeCharacter("c1", "/api/generated/t4/a.png"),
      makeCharacter("c2", "/api/generated/t4/b.png"),
      makeCharacter("c3", "/api/generated/t4/c.png"),
    ];
    const mock = mockPrepare("t4");

    const { files } = await preparePortraitReferences(characters, [
      "c1",
      "c2",
      "c3",
    ]);

    expect(files).toHaveLength(2);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("会话内缓存：批量生成时同一张定妆照只上传一次", async () => {
    const characters = [makeCharacter("c1", "/api/generated/t5/a.png")];
    const mock = mockPrepare("t5");

    const first = await preparePortraitReferences(characters, ["c1"]);
    const second = await preparePortraitReferences(characters, ["c1"]);

    expect(first.files).toEqual(["up-t5-a.png"]);
    expect(second.files).toEqual(["up-t5-a.png"]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
