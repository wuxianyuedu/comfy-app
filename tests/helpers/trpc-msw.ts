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
 * @module tests/helpers/trpc-msw — tests/helpers/trpc-msw.ts — 前端集成测试的「传输层」基建
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
 * 把一个已经拿到的 `Request` 转发给指定 router。
 *
 * 用途：测试中途用 `server.use()` 换一条**可控 router**（例如让某个 procedure
 * 卡住到我们显式放行），而不必重建 MSW server。
 *
 * @param req 原始请求
 * @param router 承接它的 tRPC router
 */
export async function forwardForTest(
  req: Request,
  router: AnyRouter,
): Promise<Response> {
  return forward(req, router);
}

/**
 * 建立一个把 `/api/trpc/*` 请求转发给 `router` 的 MSW server。
 *
 * 用法（每个测试文件）：
 *   建 server：const server = setupTrpcServer(mockRouter);
 *   启动：beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
 *   每条用例后重置：afterEach(() => server.resetHandlers());
 *   收尾关闭：afterAll(() => server.close());
 */
export function setupTrpcServer(router: AnyRouter) {
  return setupServer(
    // path 不带 host 前缀时，msw 对「绝对 URL 请求」不匹配（连 * 通配段也
    // 不生效），测试 client 的 httpBatchStreamLink 打的是完整
    // http://localhost:3100/api/trpc/...。`*` + `/api/trpc/*` 拼出的
    // `*/api/trpc/*` 与 host 无关，换端口/主机名都不用跟着改。
    http.all(`*${ENDPOINT}/*`, async ({ request }) => forward(request, router)),
  );
}
