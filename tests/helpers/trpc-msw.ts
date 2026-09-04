/**
 * tests/helpers/trpc-msw.ts — 前端集成测试的「传输层」基建。
 *
 * 目标：让被测组件走**真实**的 tRPC React 客户端（`~/trpc/react` 的 httpBatchStreamLink，
 * 底层 fetch 打到 `/api/trpc`），再由 MSW 在网络层拦截后转发给一个**可控的测试 router**
 * （`initTRPC` 现造，procedure 返回测试预设的数据 / 抛错 / 延迟）。这样：
 *   - 不用 `vi.mock("~/trpc/vanilla")` 那种「永不 resolve 的 pending」桩；
 *   - 组件里 useQuery/useMutation 的 loading → data → error、缓存失效/乐观更新
 *     是经由真实 QueryClient + tRPC client 的**完整管线**流转的，可被断言。
 *
 * 转发用 `@trpc/server/adapters/fetch` 的 `fetchRequestHandler` 现算响应，
 * 保证 batch-stream(application/jsonl) 的线格式与服务端一致，测试不用手拼 NDJSON。
 *
 * @module tests/helpers/trpc-msw
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyRouter } from "@trpc/server";

const ENDPOINT = "/api/trpc";

/** 把 fetchRequestHandler 的 Response 转成 MSW 的 HttpResponse（保留流式 body）。 */
async function forward(req: Request, router: AnyRouter): Promise<Response> {
  const upstream = await fetchRequestHandler({
    endpoint: ENDPOINT,
    req,
    router,
    createContext: () => ({}),
  });
  const body = await upstream.arrayBuffer();
  return new HttpResponse(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      vary: upstream.headers.get("vary") ?? "",
    },
  });
}

/**
 * 建立一个把 `/api/trpc/*` 请求转发给 `router` 的 MSW server。
 *
 * 用法（每个测试文件）：
 *   const server = setupTrpcServer(mockRouter);
 *   beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
 *   afterEach(() => server.resetHandlers());
 *   afterAll(() => server.close());
 */
export function setupTrpcServer(router: AnyRouter) {
  return setupServer(
    http.all(`${ENDPOINT}/*`, async ({ request }) => forward(request, router)),
  );
}
