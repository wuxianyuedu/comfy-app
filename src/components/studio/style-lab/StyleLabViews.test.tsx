import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StyleLabList } from "./StyleLabList";
import { StyleLabCreateForm } from "./StyleLabCreateForm";
import type { StyleLabController } from "./hooks/use-style-lab";
import type { StyleLabListItem } from "~/lib/style-lab/style-lab-types";

/**
 * 第③层的纯视图用例。
 *
 * 直接渲染两个叶子视图（列表 / 新建表单）而不是整块 `StyleLabView`：要验的三件事
 * （空态、列表那行「N 风格 × M 特征 = K 格」、校验提示）都长在叶子视图里，而容器
 * 层还叠着顶栏动作槽（`ViewActions`）与懒加载背景 —— 那些的挂载态不是这一刀要判的，
 * 把它们拖进来只会让用例去依赖壳的上下文。视图不取数，所以喂一份假 controller 即可。
 */
afterEach(cleanup);

const baseItem: StyleLabListItem = {
  id: "exp-1",
  name: "冷艳 × 赛博",
  workflowId: "wf-1",
  mode: "T2I",
  styles: ["赛博朋克", "暗黑"],
  traits: { temperament: ["清冷", "知性", "飒爽"] },
  params: {},
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  cellCount: 0,
  doneCount: 0,
};

function makeController(
  over: Partial<StyleLabController> = {},
): StyleLabController {
  const base: StyleLabController = {
    loading: false,
    loadError: null,
    items: [],
    workflowOptions: [],
    form: { name: "", workflowId: "", mode: "", styles: [], traits: {} },
    selectedModes: [],
    preview: {
      styleCount: 0,
      comboCount: 1,
      cellCount: 1,
      etaText: "不到 1 分钟",
      overSoft: false,
      overHard: false,
    },
    formError: null,
    canSubmit: false,
    creating: false,
    setName: vi.fn(),
    selectWorkflow: vi.fn(),
    setMode: vi.fn(),
    setStyles: vi.fn(),
    setTraitValues: vi.fn(),
    submit: vi.fn(async () => undefined),
    deleteTargetId: null,
    deletingId: null,
    askDelete: vi.fn(),
    cancelDelete: vi.fn(),
    confirmDelete: vi.fn(async () => undefined),
    batchRunner: { label: "批量生成", reason: "下一批开放", enabled: false },
    refresh: vi.fn(),
  };
  return { ...base, ...over };
}

describe("StyleLabList · 空列表", () => {
  it("一条也没有时给一句诚实的空态，而不是一个空白框", () => {
    render(<StyleLabList c={makeController({ items: [] })} />);
    expect(screen.getByText(/还没有登记过试验/)).toBeTruthy();
  });
});

describe("StyleLabList · 列表渲染", () => {
  it("把「N 风格 × M 特征 = K 格」与完成度、名称一起铺出来", () => {
    render(<StyleLabList c={makeController({ items: [baseItem] })} />);
    expect(screen.getByText("冷艳 × 赛博")).toBeTruthy();
    // 2 风格 ×（3 特征叉积）= 6 格；这一句是 config 的纯派生，视图只渲染。
    expect(screen.getByText(/2 风格 × 3 特征 = 6 格/)).toBeTruthy();
    expect(screen.getByText(/完成度 0 \/ 0/)).toBeTruthy();
  });

  it("删除是先确认、不是点一下就落地", () => {
    const askDelete = vi.fn();
    render(
      <StyleLabList
        c={makeController({ items: [baseItem], askDelete })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /删除试验「冷艳 × 赛博」/ }),
    );
    expect(askDelete).toHaveBeenCalledWith("exp-1");
  });
});

describe("StyleLabCreateForm · 校验提示", () => {
  it("缺模式时把 controller 给的校验话术显示成 alert", () => {
    render(
      <StyleLabCreateForm
        c={makeController({
          workflowOptions: [
            { id: "wf-1", name: "文生图基础流", readyModes: ["T2I"], defaultMode: "T2I" },
          ],
          selectedModes: ["T2I"],
          form: {
            name: "有名字",
            workflowId: "wf-1",
            mode: "",
            styles: [],
            traits: {},
          },
          formError: "请选择一个模式",
        })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("请选择一个模式");
  });

  it("批量生成那枚按钮禁用，并带那句诚实说明（不假装能跑）", () => {
    /* 前置条件必须与断言对象一致：workflowOptions 为空时表单整块不渲染
       （走「没有就绪工作流」那条分支），按钮根本不存在。 */
    render(
      <StyleLabCreateForm
        c={makeController({
          workflowOptions: [
            {
              id: "wf-1",
              name: "SDXL 写实人像",
              readyModes: ["T2I"],
              defaultMode: "T2I",
            },
          ],
        })}
      />,
    );
    const run = screen.getByRole("button", { name: /下一批开放/ });
    expect(run.getAttribute("disabled")).not.toBeNull();
    expect(run.textContent).toContain("批量生成");
  });
});
