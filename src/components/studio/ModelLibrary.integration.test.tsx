import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { TRPCError } from "@trpc/server";
import { setupTrpcServer } from "../../../tests/helpers/trpc-msw";
import { createTestTRPC } from "../../../tests/helpers/test-trpc";
import { renderWithProviders } from "../../../tests/helpers/renderWithProviders";
import { pageHeaderTitle } from "./NavItems";
import { ModelLibrary } from "./ModelLibrary";

/* ModelLibrary 走 trpc.model.list / trpc.model.sync 两条真实 tRPC 管线。
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
  /** 弹层里那条连接状态行的数据源（缺省 true = 历史行为）。 */
  comfyReachable?: boolean;
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
      if (behavior.listError) {
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
      rows: [],
      comfyReachable: behavior.comfyReachable ?? true,
    })),
    configSave: t.procedure.mutation(() => ({ ok: true })),
    configDelete: t.procedure.mutation(() => ({ ok: true })),
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

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  behavior = { models: [] };
  server.resetHandlers();
});
afterAll(() => server.close());

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

  /* 档位 chip 的形态（ISSUE #1925 收口）：此前是本文件里手搓的 `FilterChip`
   * （`Button variant="ghost"` + 选中三元 `bg-primary-500/20 text-primary-strong
   * hover:bg-primary-500/30`）—— 它把选中态写成了一条近乎同值的底 + 一个在
   * 悬停时才变的字色，缺「与常态同值的 hover」那一半。现在整排交给
   * `ui/select-chip`：选中态四层俱在、且悬停值回钉常态。 */
  it("档位 chip 走 select-chip 的选中态契约（radiogroup + 四层 + 悬停回钉）", async () => {
    setBehavior({ models: [ONE_MODEL] });
    renderWithProviders(<ModelLibrary />);

    await waitFor(
      () => expect(screen.getByText("dreamshaper-xl.safetensors")).toBeInTheDocument(),
      { timeout: 3000 },
    );

    expect(screen.getByRole("radiogroup", { name: "按类型筛选模型" })).toBeInTheDocument();

    // 「全部」这一枚默认选中 —— 它必须自带四层（底色 / 字色 / 描边 / 字重），
    // 且悬停值钉回常态，否则划过已选中项时会被 Button 的默认悬停档改写。
    const checked = screen
      .getAllByRole("radio")
      .find((el) => el.getAttribute("aria-checked") === "true")!;
    expect(checked).toBeTruthy();
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
    ]) {
      expect(checked.className).toContain(layer);
    }
  });

  /**
   * 现场（业主截图）：一台**没配 ComfyUI 路径**的机器上，弹层写着
   * 「● ComfyUI 已连接 · 共 0 个目录」，而服务端那次探测必然落空（`comfyBase()`
   * 指向没人监听的 8188 ⇒ `fetch` 抛错 ⇒ `comfyReachable:false`）。
   * 视图这一侧只钉一条：服务端说不可达时，「已连接」三个字不许出现在屏上。
   */
  it("连接状态行：服务端报不可达时不许出现「已连接」", async () => {
    setBehavior({ comfyReachable: false });
    renderWithProviders(<ModelLibrary />);

    fireEvent.click(screen.getByRole("button", { name: "模型目录配置" }));
    await waitFor(() => expect(screen.getByText("● ComfyUI 未连接")).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.queryByText(/ComfyUI 已连接/)).toBeNull();
  });
});
