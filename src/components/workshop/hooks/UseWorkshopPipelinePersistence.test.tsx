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
import { useWorkshopPipeline } from "@/components/workshop/hooks/use-workshop-pipeline";

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
