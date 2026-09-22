// @vitest-environment jsdom
//
// 工坊持久化回归测试（Phase 2 重写）。
//
// 历史根因（仍要守住）：loadWorkshopDraftOnce() 只在缓存 === undefined 时从
// localStorage 重读，而卸载时 invalidateDraftCache() 把缓存置 null —— null !==
// undefined，重挂载会跳过重读、返回 null，导致切页签后剧本被清空。本测试覆盖
// 「导入剧本 → 卸载(切页签) → 重挂载(切回)」内容应保留。
//
// Phase 2 变更：工坊不再有自建的 wsp_* 多项目，当前项目 = 画布活跃 proj_*
// （canvas-store.getActiveId）。所以测试先经 canvas-store 建一个真实项目，
// 再验证工坊按该 proj_* 键持久化。原「工坊内建第二个项目 / 切换 / 定妆照期换
// 项目」的用例随该能力移除而删除——项目切换统一在首页发生，不在工坊内。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { createProject, getActiveId } from "~/lib/project-canvas/canvas-store";

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

describe("useWorkshopPipeline 剧本持久化回归（Phase 2：按 proj_* 键）", () => {
  it("工坊跟随画布活跃项目：activeProjectId = 当前 proj_*", () => {
    const project = createProject("我的短剧");
    const { result } = renderHook(() => useWorkshopPipeline());
    expect(result.current.activeProjectId).toBe(project.id);
    expect(getActiveId()).toBe(project.id);
  });

  it("导入剧本后切页签(卸载)再切回，内容不丢失", () => {
    const project = createProject();
    const projectId = project.id;

    const first = renderHook(() => useWorkshopPipeline());
    expect(first.result.current.scriptMarkdown).toBe("");
    expect(first.result.current.activeProjectId).toBe(projectId);

    // 用户文件导入剧本 → 等价 setScriptMarkdown(text)
    act(() => {
      first.result.current.setScriptMarkdown(SCRIPT);
    });
    expect(first.result.current.scriptMarkdown).toBe(SCRIPT);

    // 切走页签 → 卸载兜底应已把剧本落盘到按 proj_* 命名的键
    first.unmount();
    const key = `comfyapp.workshop.draft.${projectId}.v1`;
    const stored: string | null = localStorage.getItem(key);
    expect(stored).toBeTruthy();
    expect(
      (JSON.parse(stored!) as { scriptMarkdown: string }).scriptMarkdown,
    ).toBe(SCRIPT);

    // 切回 → 重挂载，剧本应恢复而非清空
    const second = renderHook(() => useWorkshopPipeline());
    expect(second.result.current.activeProjectId).toBe(projectId);
    expect(second.result.current.scriptMarkdown).toBe(SCRIPT);
    second.unmount();
  });

  it("无活跃项目时工坊不崩：activeProjectId 为空串、状态落默认值", () => {
    // 不建项目直接渲染（异常路径；正常由 Phase 1 闸门保证有活跃项目）
    const { result } = renderHook(() => useWorkshopPipeline());
    expect(result.current.activeProjectId).toBe("");
    expect(result.current.scriptMarkdown).toBe("");
  });
});
