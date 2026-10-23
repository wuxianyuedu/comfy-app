import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StyleLabCells } from "./StyleLabCells";
import { StyleLabCreateForm } from "./StyleLabCreateForm";
import { StyleLabList } from "./StyleLabList";
import {
  cellStatusText,
  summarizeBatch,
  traitKeyDisplayText,
} from "./style-lab-config";
import type { StyleLabController } from "./hooks/use-style-lab";
import type {
  StyleLabCellWithStatus,
  StyleLabListItem,
} from "~/lib/style-lab/style-lab-types";

/**
 * 第③层的纯视图用例 + 第①层屏内派生的用例。
 *
 * 直接渲染叶子视图（列表 / 新建表单 / 座位表）而不是整块 `StyleLabView`：要验的那
 * 几件事（空态、矩阵那句算式、校验提示、扇出后的三句话与每格状态）都长在叶子里，
 * 而容器层还叠着顶栏动作槽（`ViewActions`）与懒加载背景 —— 那些的挂载态不是这一刀
 * 要判的。视图不取数，所以喂一份假 controller 即可。
 *
 * 扇出这一刀新增的三条判据写成**纯函数用例**而不是只靠渲染断言：`traitKeyDisplayText`
 * （身份键 → 文案，含认不出的轴 id 时不整段丢）、`cellStatusText`（未入队 / 任务已
 * 不在 / 状态表三档分开）、`summarizeBatch`（一格也没入队时不许说「已开始」）——
 * 这三处是这一屏最容易「看起来对、其实错」的地方。
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

const baseCell: StyleLabCellWithStatus = {
  id: "cell-1",
  experimentId: "exp-1",
  style: "厚涂",
  traitKey: "costume=唐装",
  prompt: "唐装, 厚涂",
  isRepresentative: true,
  taskId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  status: null,
  imageUrl: null,
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
    expandedId: null,
    expand: vi.fn(),
    collapse: vi.fn(),
    cells: [],
    cellsLoading: false,
    cellsError: null,
    runningBatchId: null,
    runBatch: vi.fn(async () => undefined),
    stoppingBatchId: null,
    stopBatch: vi.fn(async () => undefined),
    batchSummary: null,
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

  it("收起时点「看格子」把这一条展开", () => {
    const expand = vi.fn();
    render(
      <StyleLabList c={makeController({ items: [baseItem], expand })} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /展开试验「冷艳 × 赛博」的格子/ }),
    );
    expect(expand).toHaveBeenCalledWith("exp-1");
  });

  it("展开时那枚按钮改收成 collapse，且 aria-controls 指得到真的存在的块", () => {
    const collapse = vi.fn();
    render(
      <StyleLabList
        c={makeController({
          items: [baseItem],
          expandedId: baseItem.id,
          collapse,
          cells: [baseCell],
        })}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: /收起试验「冷艳 × 赛博」的格子/,
    });
    expect(toggle.getAttribute("aria-controls")).toBe("style-lab-cells-exp-1");
    expect(document.getElementById("style-lab-cells-exp-1")).not.toBeNull();
    fireEvent.click(toggle);
    expect(collapse).toHaveBeenCalled();
  });

  it("删除是先确认、不是点一下就落地", () => {
    const askDelete = vi.fn();
    render(
      <StyleLabList c={makeController({ items: [baseItem], askDelete })} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /删除试验「冷艳 × 赛博」/ }),
    );
    expect(askDelete).toHaveBeenCalledWith("exp-1");
  });
});

describe("StyleLabCreateForm · 校验与入口", () => {
  it("缺模式时把 controller 给的校验话术显示成 alert", () => {
    render(
      <StyleLabCreateForm
        c={makeController({
          workflowOptions: [
            {
              id: "wf-1",
              name: "文生图基础流",
              readyModes: ["T2I"],
              defaultMode: "T2I",
            },
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

  it("表单里不再摆那枚永远禁用的「批量生成」—— 入口在列表每一行", () => {
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
    expect(screen.queryByText(/下一批开放/)).toBeNull();
    expect(
      screen.getByText(/创建后在「试验记录」里展开这一条/),
    ).toBeTruthy();
  });
});

describe("StyleLabCells · 座位表", () => {
  it("收起状态什么都不渲染（座位表只按展开的那一条现读）", () => {
    const { container } = render(
      <StyleLabCells
        c={makeController({ expandedId: null })}
        experiment={baseItem}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("没跑过时给一句「这批还没跑过」，而不是一个空白网格", () => {
    render(
      <StyleLabCells
        c={makeController({ expandedId: baseItem.id, cells: [] })}
        experiment={baseItem}
      />,
    );
    expect(screen.getByText(/这批还没跑过/)).toBeTruthy();
  });

  it("每格给出风格、特征、状态；未入队与排队中分得开", () => {
    render(
      <StyleLabCells
        c={makeController({
          expandedId: baseItem.id,
          cells: [
            baseCell,
            { ...baseCell, id: "cell-2", taskId: "t-2", status: "QUEUED" },
          ],
        })}
        experiment={baseItem}
      />,
    );
    expect(screen.getAllByText("厚涂")).toHaveLength(2);
    expect(screen.getAllByText("服装：唐装")).toHaveLength(2);
    expect(screen.getByText("未入队")).toBeTruthy();
    expect(screen.getByText("排队中")).toBeTruthy();
  });

  it("扇出进行中时那枚按钮禁用，并把文案换成「正在排队」", () => {
    render(
      <StyleLabCells
        c={makeController({
          expandedId: baseItem.id,
          runningBatchId: baseItem.id,
        })}
        experiment={baseItem}
      />,
    );
    const button = screen.getByRole("button", { name: /正在排队/ });
    expect(button.getAttribute("disabled")).not.toBeNull();
  });

  it("还有在跑的格子时才摆「停一批」，点了传这一条的 id", () => {
    const stopBatch = vi.fn(async () => undefined);
    render(
      <StyleLabCells
        c={makeController({
          expandedId: baseItem.id,
          stopBatch,
          cells: [{ ...baseCell, taskId: "t-1", status: "RUNNING" }],
        })}
        experiment={baseItem}
      />,
    );
    /* 可访问名是 aria-label 那句（列表里同时展开几条时，「停一批」必须说清停的
       是哪一条），可见文案仍是「停一批」。 */
    fireEvent.click(
      screen.getByRole("button", {
        name: "取消试验「冷艳 × 赛博」还没出完的格子",
      }),
    );
    expect(stopBatch).toHaveBeenCalledWith("exp-1");
  });

  it("全批都出完时不摆「停一批」（点它只会得到一句「没有在跑」）", () => {
    render(
      <StyleLabCells
        c={makeController({
          expandedId: baseItem.id,
          cells: [{ ...baseCell, taskId: "t-1", status: "SUCCEEDED" }],
        })}
        experiment={baseItem}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: "取消试验「冷艳 × 赛博」还没出完的格子",
      }),
    ).toBeNull();
  });

  it("扇出的三句话：状态那一句走 role=status，没生效的口走 role=alert", () => {
    render(
      <StyleLabCells
        c={makeController({
          expandedId: baseItem.id,
          cells: [baseCell],
          batchSummary: summarizeBatch({
            enqueued: 4,
            skipped: 2,
            baseSeed: 1234,
            unmatched: ["seed"],
          }),
        })}
        experiment={baseItem}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "已把 4 格排进队列",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "这批共用基准 seed 1234",
    );
    expect(screen.getByRole("alert").textContent).toContain("未生效");
  });

  it("读座位表失败时如实报错，不沿用上一份格子", () => {
    render(
      <StyleLabCells
        c={makeController({
          expandedId: baseItem.id,
          cells: [],
          cellsError: "读不到这一条的格子，后端可能刚重启",
        })}
        experiment={baseItem}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "读不到这一条的格子",
    );
  });
});

describe("traitKeyDisplayText —— 身份键 → 屏上文案", () => {
  it("带轴 id 的键翻成「维度名：值」，多维用「 · 」连", () => {
    expect(traitKeyDisplayText("costume=唐装;temperament=清冷")).toBe(
      "服装：唐装 · 气质：清冷",
    );
  });

  it("空键（不约束特征）给「仅风格」，不给一个空白", () => {
    expect(traitKeyDisplayText("")).toBe("仅风格");
  });

  it("认不出的轴 id 只丢维度名、留住值 —— 那格确实出过图", () => {
    expect(traitKeyDisplayText("hair=长发")).toBe("长发");
  });
});

describe("cellStatusText —— 三档要分得开", () => {
  it("没绑任务是「未入队」", () => {
    expect(cellStatusText({ taskId: null, status: null })).toBe("未入队");
  });

  it("绑了任务却读不到状态是「任务已不在」，不是「未知」", () => {
    expect(cellStatusText({ taskId: "t-1", status: null })).toBe("任务已不在");
  });

  it("其余一律读任务状态表那一份（同一种状态在两屏上同名）", () => {
    expect(cellStatusText({ taskId: "t-1", status: "QUEUED" })).toBe("排队中");
    expect(cellStatusText({ taskId: "t-1", status: "SUCCEEDED" })).toBe(
      "已完成",
    );
  });
});

describe("summarizeBatch —— 那三句话不许说谎", () => {
  it("有新格入队时报格数、跳过数与共用 seed", () => {
    const s = summarizeBatch({
      enqueued: 6,
      skipped: 1,
      baseSeed: 42,
      unmatched: [],
    });
    expect(s.queuedText).toBe("已把 6 格排进队列，跳过 1 格已出图的");
    expect(s.seedText).toBe("这批共用基准 seed 42");
    expect(s.unmatchedText).toBeNull();
  });

  it("一格也没入队时不说「已开始」，也不报那个没用上的 seed", () => {
    const s = summarizeBatch({
      enqueued: 0,
      skipped: 6,
      baseSeed: 42,
      unmatched: [],
    });
    expect(s.queuedText).toContain("没有新格子要跑");
    expect(s.seedText).toBeNull();
  });

  it("seed 落在未生效那一档时把那句话带回来（「共用 seed」的承诺落空必须可见）", () => {
    const s = summarizeBatch({
      enqueued: 2,
      skipped: 0,
      baseSeed: 42,
      unmatched: ["seed"],
    });
    expect(s.unmatchedText).toContain("未生效");
    expect(s.unmatchedText).toContain("种子");
  });
});
