// @vitest-environment jsdom
//
// 回归测试：工坊「切页签再切回导致剧本内容丢失」反复出现。
// 根因：loadWorkshopDraftOnce() 原先只在缓存 === undefined 时从 localStorage 重读，
//       而卸载/切项目 invalidateDraftCache() 把缓存置为 null —— null !== undefined，
//       重挂载会跳过重读、直接返回 null，导致 scriptMarkdown 被初始化为空。
//       文件导入 / 任何对空剧本的首次写入在切页签后都会丢。
// 本测试覆盖「导入剧本 → 卸载(切页签) → 重挂载(切回)」内容应保留。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { generateWorkflowPortrait } from "~/lib/workshop/character-portrait-client";
import type { Character } from "~/lib/workshop/types";

/* 本文件同时守着「定妆照任务期间不许换项目」的门禁（见下方 describe）：
 * 生成动辄数分钟，换项目会让在途结果无处可写 —— 拦住并用 notice 说明，比让
 * 项目切换器无声失效可接受。 */
vi.mock("~/lib/workshop/character-portrait-client", () => ({
  generateWorkflowPortrait: vi.fn(),
  generateRemotePortrait: vi.fn(),
  importPortraitFile: vi.fn(),
}));

const SCRIPT = "# 我的剧本\n场景一 小满出门";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("/api/workshop/draft")) {
      return new Response(JSON.stringify({ drafts: [], exists: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ skills: [], models: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => cleanup());

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

describe("useWorkshopPipeline 剧本持久化回归", () => {
  it("导入剧本后切页签(卸载)再切回，内容不丢失", () => {
    // 首次进入剧本页（无剧本）
    const first = renderHook(() => useWorkshopPipeline());
    expect(first.result.current.scriptMarkdown).toBe("");
    const projectId = first.result.current.activeProjectId;

    // 用户直接文件导入剧本 → 等价 handleScriptImport 内 setScriptMarkdown(text)
    act(() => {
      first.result.current.setScriptMarkdown(SCRIPT);
    });
    expect(first.result.current.scriptMarkdown).toBe(SCRIPT);

    // 立刻切走页签 → WorkshopPipeline 卸载（卸载兜底应已把剧本落盘到 localStorage）
    first.unmount();
    const key = `comfyapp.workshop.draft.${projectId}.v1`;
    const stored: string | null = localStorage.getItem(key);
    expect(stored).toBeTruthy();
    expect(
      (JSON.parse(stored!) as { scriptMarkdown: string }).scriptMarkdown,
    ).toBe(SCRIPT);

    // 切回剧本页 → 组件重挂载，剧本应恢复而非清空
    const second = renderHook(() => useWorkshopPipeline());
    expect(second.result.current.activeProjectId).toBe(projectId);
    expect(second.result.current.scriptMarkdown).toBe(SCRIPT);
    second.unmount();
  });
});

function makeCharacter(): Character {
  return {
    id: "c1",
    name: "阿澈",
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "a young man, cinematic lighting",
    negativePrompt: "",
    params: {},
  };
}

describe("useWorkshopPipeline 定妆照任务期间的项目门禁", () => {
  it("生成中切换 / 新建项目被拦下并给出可见提示，跑完后恢复正常", async () => {
    let resolveTask!: (value: { taskId: string; url: string }) => void;
    vi.mocked(generateWorkflowPortrait).mockImplementation(
      () =>
        new Promise<{ taskId: string; url: string }>((resolve) => {
          resolveTask = resolve;
        }),
    );

    const { result } = renderHook(() => useWorkshopPipeline());
    const character = makeCharacter();

    // 先造出第二个项目，才有「可切换的目标」
    let otherId = "";
    act(() => {
      result.current.createProject("另一个项目");
    });
    otherId = result.current.activeProjectId;
    const homeId = result.current.projects.find(
      (item) => item.id !== otherId,
    )!.id;
    expect(result.current.projects).toHaveLength(2);

    act(() => {
      result.current.setCharacters([character]);
    });

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.characterPortraitActions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });
    expect(result.current.characterPortrait.busy).toBe(true);

    // 切项目：被拦下，且必须说明原因（不能只是按钮没反应）
    act(() => {
      result.current.switchProject(homeId);
    });
    expect(result.current.activeProjectId).toBe(otherId);
    expect(result.current.notice).toContain("定妆照正在生成");

    // 新建项目同样会把 activeId 切走 → 一并拦下
    act(() => {
      result.current.createProject("第三个");
    });
    expect(result.current.activeProjectId).toBe(otherId);
    expect(result.current.projects).toHaveLength(2);

    await act(async () => {
      resolveTask({ taskId: "task-1", url: "/api/generated/a.png" });
      await pending;
    });
    expect(result.current.characterPortrait.busy).toBe(false);

    // 任务跑完后不再拦
    act(() => {
      result.current.switchProject(homeId);
    });
    expect(result.current.activeProjectId).toBe(homeId);
  });
});
