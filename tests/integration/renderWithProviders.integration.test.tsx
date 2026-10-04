// @vitest-environment jsdom
/**
 * 前端集成层自检：验证「MSW 拦截 /api/trpc → 测试 router」能驱动真实 tRPC client
 * 走完整数据态流转，而非「永不 resolve」桩。用自建 tRPC React 实例 + 自建 router +
 * `createTestQueryClient()`（renderWithProviders 同款隔离 QueryClient），跑通三种流转：
 *  1) loading→data
 *  2) loading→error（router 抛 TRPCError）
 *  3) mutation 成功→invalidate→列表自动新增（缓存失效）
 *
 * 说明：真组件集成测试（ModelLibrary.integration.test.tsx）直接用 renderWithProviders
 * 消费 `~/trpc/react` 的真实 api 路由；本文件用局部 createTRPCReact 实例通用地验证
 * 「MSW + QueryClient + tRPC client」这套集成层本身可驱动数据态流转。
 */
import { useState, type ReactElement } from "react";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { z } from "zod";
import { setupTrpcServer } from "../helpers/trpc-msw";
import { createTestTRPC } from "../helpers/test-trpc";
import { createTestQueryClient } from "../helpers/renderWithProviders";

/* ---------- 可控 behavior ---------- */
interface Behavior {
  tags: string[];
  listError?: string;
  delayMs?: number;
}
let behavior: Behavior = { tags: [] };

const t = createTestTRPC();
const mockRouter = t.router({
  tag: t.router({
    list: t.procedure.query(async () => {
      if (behavior.listError) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: behavior.listError });
      }
      if (behavior.delayMs) await new Promise((r) => setTimeout(r, behavior.delayMs));
      return { tags: behavior.tags };
    }),
    add: t.procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input }) => {
        behavior.tags = [...behavior.tags, input.name];
        return { tags: behavior.tags };
      }),
  }),
});
type MockRouter = typeof mockRouter;

const server = setupTrpcServer(mockRouter);
const BASE = "http://localhost:3100/api/trpc";

const localApi = createTRPCReact<MockRouter>();
const localTrpcClient = localApi.createClient({
  links: [httpBatchStreamLink({ transformer: SuperJSON, url: BASE })],
});

/* ---------- 组合 renderWithProviders 同款隔离 QueryClient + 局部 api ---------- */
function renderTagDemo(ui: ReactElement) {
  const qc = createTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <localApi.Provider client={localTrpcClient} queryClient={qc}>
        {ui}
      </localApi.Provider>
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  behavior = { tags: [] };
  server.resetHandlers();
});
afterAll(() => server.close());

/* ---------- 本地 harness：消费 localApi.tag.list / .add ---------- */
function TagDemo() {
  const listQ = localApi.tag.list.useQuery(undefined, { placeholderData: (p) => p });
  const utils = localApi.useUtils();
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    try {
      await utils.client.tag.add.mutate({ name: "fresh" });
      await utils.tag.list.invalidate();
    } catch {
      setErr("add 失败");
    }
  };

  return (
    <div>
      <h1>标签库</h1>
      {listQ.isLoading && <div data-testid="loading">加载中…</div>}
      {listQ.isError && (
        <div data-testid="error">
          {(listQ.error as { message?: string } | null)?.message ?? "加载失败"}
        </div>
      )}
      {listQ.data && (
        <ul data-testid="tag-list">
          {listQ.data.tags.map((tg) => (
            <li key={tg} data-testid="tag-item">
              {tg}
            </li>
          ))}
        </ul>
      )}
      <button onClick={add}>新增 fresh</button>
      {err && <div data-testid="adderr">{err}</div>}
    </div>
  );
}

describe("前端集成层 · MSW 数据态流转自检", () => {
  it("1. loading→data：先出 loading，回包后渲染数据", async () => {
    behavior = { tags: ["checkpoint", "lora"], delayMs: 50 };
    renderTagDemo(<TagDemo />);

    expect(screen.getByTestId("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("loading")).not.toBeInTheDocument());
    expect(screen.getAllByTestId("tag-item").map((n) => n.textContent)).toEqual(["checkpoint", "lora"]);
  });

  it("2. loading→error：router 抛错后进入错误态（不再停留 loading）", async () => {
    behavior = { tags: [], listError: "数据库不可用" };
    renderTagDemo(<TagDemo />);

    await waitFor(() => expect(screen.getByTestId("error")).toBeInTheDocument());
    expect(screen.getByTestId("error").textContent).toContain("数据库不可用");
    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
  });

  it("3. mutation→invalidate→列表自动新增（缓存失效）", async () => {
    behavior = { tags: ["checkpoint"] };
    renderTagDemo(<TagDemo />);
    await waitFor(() => expect(screen.getAllByTestId("tag-item").length).toBe(1));

    await userEvent.click(screen.getByRole("button", { name: "新增 fresh" }));

    await waitFor(() => {
      expect(screen.getAllByTestId("tag-item").map((n) => n.textContent)).toContain("fresh");
    });
    expect(screen.getAllByTestId("tag-item").length).toBe(2);
  });
});
