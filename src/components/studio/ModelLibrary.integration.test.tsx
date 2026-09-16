// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { TRPCError } from "@trpc/server";
import { setupTrpcServer } from "../../../tests/helpers/trpc-msw";
import { createTestTRPC } from "../../../tests/helpers/test-trpc";
import { renderWithProviders } from "../../../tests/helpers/renderWithProviders";
import { ModelLibrary } from "./ModelLibrary";

/* ModelLibrary 走 api.model.list / api.model.sync 两条真实 tRPC 管线。
 * 用「可变 behavior」驱动测试 router 在 MSW 网络层提供可控数据/错误，
 * 从而断言组件数据态流转（loading→data / loading→error），而不是
 * vi.mock("~/trpc/vanilla") 那种永不 resolve 的 pending 冒烟。 */

interface ModelRow {
  id: string;
  name: string;
  fileName: string;
  type: string;
  isAvailable: boolean;
  fileSize?: number | null;
}
interface Behavior {
  models: ModelRow[];
  /** 非空时 list 抛错 → 覆盖组件错误态 */
  listError?: string;
}

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
      comfyReachable: true,
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

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
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

    // loading 态：未回包前出现加载文案（sync 尚在飞、list 未回）
    expect(screen.getByText("加载中…")).toBeInTheDocument();

    // data 态：MSW 返回后出现模型文件名行
    await waitFor(
      () =>
        expect(
          screen.getByText("dreamshaper-xl.safetensors"),
        ).toBeInTheDocument(),
      {
        timeout: 3000,
      },
    );
    // 模型库标题区域
    expect(screen.getByText("模型库")).toBeInTheDocument();
  });
});
