/* useWorkflowImport 的行为单测（#4457 / #4462）：
 *  ① 粘贴路径与文件入口走同一个 RAW 判据（粘贴 API 格式不再「成功」入库）；
 *  ② 导入成功带解析告警时面板保持打开、告警可见（不再被同批关闭吞掉）；
 *  ③ 再次打开面板不残留上一次的告警 / 错误。
 * createMut 用桩（hook 以参数注入，不起 tRPC 管线）。 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RouterInputs, RouterOutputs } from "~/trpc/react";

import { useWorkflowImport } from "./use-workflow-import";

const RAW_JSON = JSON.stringify({
  last_node_id: 1,
  nodes: [{ id: 1, type: "KSampler", pos: [0, 0], widgets_values: [] }],
  links: [],
});
/* API 格式（`{ "<id>": { class_type, inputs } }`）—— 本应用不支持的导入形态。 */
const API_JSON = JSON.stringify({ "1": { class_type: "KSampler", inputs: {} } });

function makeCreateMut(output: { warnings?: Array<string> }) {
  const mutateAsync = vi.fn(
    (_input: RouterInputs["workflow"]["create"]): Promise<RouterOutputs["workflow"]["create"]> => {
      return Promise.resolve({
        id: "wf-1",
        name: "n",
        taskType: "T2I",
        paramMap: {},
        hasPositions: false,
        warnings: output.warnings,
      });
    },
  );
  return { mutateAsync };
}

describe("useWorkflowImport（#4457 / #4462）", () => {
  it("#4462 粘贴 API 格式 JSON 被拒 —— 与拖入 / 选文件入口同口径", async () => {
    const createMut = makeCreateMut({});
    const load = vi.fn();
    const { result } = renderHook(() => useWorkflowImport({ createMut, load }));

    act(() => {
      result.current.setImportJson(API_JSON);
    });
    await act(async () => {
      await result.current.handleImport();
    });

    expect(result.current.importErr).toContain("不是 ComfyUI 的工作流(RAW) JSON");
    expect(createMut.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.showImport).toBe(false);
  });

  it("粘贴 RAW JSON 正常入库并关闭面板", async () => {
    const createMut = makeCreateMut({});
    const load = vi.fn();
    const { result } = renderHook(() => useWorkflowImport({ createMut, load }));

    act(() => {
      result.current.setImportJson(RAW_JSON);
    });
    await act(async () => {
      await result.current.handleImport();
    });

    expect(createMut.mutateAsync).toHaveBeenCalledTimes(1);
    expect(result.current.importErr).toBe("");
    expect(result.current.showImport).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("#4457 成功但带解析告警：面板保持打开、告警可见、输入已清空", async () => {
    const createMut = makeCreateMut({ warnings: ["节点 X 不受支持，已跳过"] });
    const load = vi.fn();
    const { result } = renderHook(() => useWorkflowImport({ createMut, load }));

    act(() => {
      result.current.openImport();
      result.current.setImportJson(RAW_JSON);
      result.current.setImportName("名字");
    });
    await act(async () => {
      await result.current.handleImport();
    });

    /* 面板此前已打开；有告警时保持打开，用户当场看到告警。 */
    expect(result.current.showImport).toBe(true);
    expect(result.current.importWarn).toEqual(["节点 X 不受支持，已跳过"]);
    /* 输入框清空：面板还开着，「确认导入」再点不会把同一条重复入库。 */
    expect(result.current.importJson).toBe("");
    expect(result.current.importName).toBe("");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("#4457 关闭后再打开面板：上一次的告警 / 错误不残留", async () => {
    const createMut = makeCreateMut({ warnings: ["旧告警"] });
    const load = vi.fn();
    const { result } = renderHook(() => useWorkflowImport({ createMut, load }));

    act(() => {
      result.current.setImportJson(RAW_JSON);
    });
    await act(async () => {
      await result.current.handleImport();
    });
    expect(result.current.importWarn).toEqual(["旧告警"]);

    act(() => {
      result.current.setShowImport(false);
    });
    act(() => {
      result.current.openImport();
    });

    expect(result.current.importWarn).toEqual([]);
    expect(result.current.importErr).toBe("");
    expect(result.current.showImport).toBe(true);
  });
});
