import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { TRPCError } from "@trpc/server";
import { setupTrpcServer } from "../../../tests/helpers/trpc-msw";
import { createTestTRPC } from "../../../tests/helpers/test-trpc";
import { renderWithProviders } from "../../../tests/helpers/renderWithProviders";
import { pageHeaderTitle } from "./NavItems";
import { ModelLibrary } from "./ModelLibrary";

/* ModelLibrary 走 trpc.model.list / trpc.model.sync / trpc.model.configList 三条真实 tRPC 管线。
 * 用「可变 behavior」驱动测试 router 在 MSW 网络层提供可控数据/错误，
 * 从而断言组件数据态流转（loading→data / loading→error），而不是
 * vi.mock("~/trpc/vanilla") 那种永不 resolve 的 pending 冒烟。 */

type ModelRow = {
  fileName: string;
  fileSize?: number | null;
  id: string;
  isAvailable: boolean;
  name: string;
  type: string;
};
type Behavior = {
  /** 设置里是否填了 ComfyUI 路径（空态文案的数据源；缺省 true = 已配置）。 */
  comfyuiPathConfigured?: boolean;
  /** 非空时 list 抛错 → 覆盖组件错误态 */
  listError?: string;
  models: Array<ModelRow>;
};

/** 由调用方在 beforeAll 里替换，各用例通过 setBehavior 改值。 */
let behavior: Behavior = { models: [] };

const t = createTestTRPC();
const mockRouter = t.router({
  model: t.router({
    list: t.procedure.query(() => {
      if (behavior.listError !== undefined && behavior.listError !== "") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: behavior.listError,
        });
      }
      return { models: behavior.models };
    }),
    sync: t.procedure.mutation(() => ({
      ok: true,
      count: behavior.models.length,
    })),
    configList: t.procedure.query(() => ({
      folders: [],
      comfyReachable: true,
      comfyuiPathConfigured: behavior.comfyuiPathConfigured ?? true,
    })),
  }),
});

const server = setupTrpcServer(mockRouter);

function setBehavior(b: Partial<Behavior>) {
  behavior = { ...behavior, ...b };
}

const ONE_MODEL: ModelRow = {
  id: "m1",
  name: "dreamshaper-xl",
  fileName: "dreamshaper-xl.safetensors",
  type: "checkpoints",
  isAvailable: true,
  fileSize: 5120,
};
const LORA_MODEL: ModelRow = {
  id: "m2",
  name: "Detail Tweaker",
  fileName: "detail.safetensors",
  type: "loras",
  isAvailable: true,
  fileSize: 1024,
};

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  cleanup();
  behavior = { models: [] };
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("ModelLibrary · 前端集成（MSW 数据态流转）", () => {
  it("mount 后先 loading，list 回包后渲染出模型行（loading→data）", async () => {
    setBehavior({ models: [ONE_MODEL] });
    renderWithProviders(<ModelLibrary />);

    // loading 态：未回包前是首屏骨架（与真实行同形，不是一行「加载中…」），
    // 且它只等 list —— 后台 sync 的全目录扫描不再挡在首屏前面。
    expect(screen.getByRole("status", { name: "正在加载模型列表" })).toBeInTheDocument();

    // data 态：MSW 返回后出现模型文件名行（等 DOM 用 waitFor，见 §11.14）
    await waitFor(
      () => expect(screen.getByText("dreamshaper-xl.safetensors")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    // 骨架让位给真列表（不是叠在上面）。按 name 查：`Spinner` 的
    // 「同步中」指示同样是 role="status"，同名不同义，不能光靠角色区分。
    expect(screen.queryByRole("status", { name: "正在加载模型列表" })).toBeNull();
    // 页头标题：与侧栏 / 页签同一个出处（注册表里这一项叫「模型」，
    // 不再是此前那个裸字面量「模型库」—— ISSUE #1673）。
    expect(screen.getByText(pageHeaderTitle("models"))).toBeInTheDocument();
  });

  /* ISSUE #3368：类型 chip 筛选整排退役，改为左侧目录列 + 右侧该目录的模型。
   * 目录列由已同步的模型派生，选中项用 `aria-current` 表达 —— 与设置页左侧
   * 分区导航同一条契约；切换目录只是换右侧列表，不发新请求。 */
  it("左侧目录列：按目录分组、默认选中第一项，点另一目录切右侧列表", async () => {
    setBehavior({ models: [ONE_MODEL, LORA_MODEL] });
    renderWithProviders(<ModelLibrary />);

    await waitFor(
      () => expect(screen.getByText("dreamshaper-xl.safetensors")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    const nav = screen.getByRole("navigation", { name: "模型目录" });
    expect(within(nav).getByText("Checkpoint")).toBeInTheDocument();
    expect(within(nav).getByText("LoRA")).toBeInTheDocument();

    // 默认选中第一项（数量都为 1 时按类型名字典序 → checkpoints 在前）
    expect(nav.querySelector('[aria-current="true"]')).not.toBeNull();

    // 切到另一个目录：右侧只剩该目录的行
    fireEvent.click(within(nav).getByRole("button", { name: /LoRA/i }));
    await waitFor(() => expect(screen.getByText("detail.safetensors")).toBeInTheDocument());
    expect(screen.queryByText("dreamshaper-xl.safetensors")).toBeNull();
  });

  it("搜索只在当前目录内命中；清空后恢复该目录全部行", async () => {
    setBehavior({ models: [ONE_MODEL, LORA_MODEL] });
    renderWithProviders(<ModelLibrary />);

    await waitFor(
      () => expect(screen.getByText("dreamshaper-xl.safetensors")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    fireEvent.change(screen.getByRole("textbox", { name: "搜索模型名称" }), {
      target: { value: "detail" },
    });
    // 当前目录（checkpoints）里没有 detail → 给出可解释的空态
    await waitFor(() => expect(screen.getByText("没有匹配的模型")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: "搜索模型名称" }), {
      target: { value: "" },
    });
    await waitFor(() => expect(screen.getByText("dreamshaper-xl.safetensors")).toBeInTheDocument());
  });

  /* ISSUE #3368 第 5 条：有模型就显示模型；只有「没配置 ComfyUI 路径」才报
   * ComfyUI 未配置的问题 —— 不再出现「没启用任何模型目录」这类配置引导。 */
  it("空库且没配 ComfyUI 路径：显示未配置空态并给出设置入口", async () => {
    setBehavior({ comfyuiPathConfigured: false });
    renderWithProviders(<ModelLibrary />);

    await waitFor(() => expect(screen.getByText("ComfyUI 还没有配置")).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole("link", { name: /去设置/ })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText(/模型目录配置/)).toBeNull();
  });

  it("空库但已配置路径：只说明还没有模型，不给设置入口", async () => {
    setBehavior({ comfyuiPathConfigured: true });
    renderWithProviders(<ModelLibrary />);

    await waitFor(() => expect(screen.getByText("模型库里还没有模型")).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByRole("link", { name: /去设置/ })).toBeNull();
  });
});
