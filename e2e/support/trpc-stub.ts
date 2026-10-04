import type { Page, Route } from "@playwright/test";
import superjson from "superjson";

/**
 * tRPC 桩：让 `route.fulfill` 出去的内容**真的进到** `httpBatchStreamLink`。
 *
 * ## 为什么直接 fulfill 一个 JSON 数组喂不进去
 *
 * 客户端用的是 `httpBatchStreamLink`（[`src/trpc/link.ts`](../../src/trpc/link.ts)），
 * 它按 **JSON Lines** 读响应体 —— 请求头 `trpc-accept: application/jsonl` 声明了这个
 * 协商结果，服务端由 `jsonlStreamProducer` 产出（见 `@trpc/server` 的
 * `resolveResponse`：`if (info.accept === "application/jsonl")` 那一支）。
 *
 * 真服务端回的是**逐行 JSON**（`content-type: application/json` +
 * `transfer-encoding: chunked`），四行就是一问一答的全部：
 *
 * ```
 * {"json":{"0":[[0],[null,0,0]]}}                  ← head：批里 0 号槽指向 0 号流
 * {"json":[0,0,[[{"result":0}],["result",0,1]]]}   ← 0 号流：槽位 → result 是个 promise
 * {"json":[1,0,[[{"data":0}],["data",0,2]]]}       ← 1 号流：result.data 也是个 promise
 * {"json":[2,0,[[{"tasks":[]}]]]}                  ← 2 号流：真数据（含 superjson meta）
 * ```
 *
 * 消费端 `jsonlStreamConsumer` 的契约是「**第一行**是 head（按 `batchIndex` 索引的
 * 对象），其后每行是 `[chunkId, status, data]` 的 async chunk 定义」。
 *
 * 所以喂一个数组进去时错在两处、且**都不抛错**（这正是 ISSUE #1442 记的
 * 「好 JSON 与坏 JSON 表现完全一致、控制台零报错」）：
 *   1. 数组里没有换行 → `createLineAccumulator` 把它整段当成**一行** → 当 head；
 *      而 head 本该是 `{"0": 信封}` 这种对象，拿到数组后 `Object.entries` 把
 *      `"0"` 索引进来的信封当成 chunk 定义去 `decodeChunkDefinition`，
 *      形状对不上（不是 `[path, type, chunkId]`）→ `type` 落空 → 槽位值
 *      `undefined`，上层静默拿不到数据；
 *   2. 就算手工拆成多行，**每行都必须是 `{"json": …}` 信封**（服务端
 *      `jsonlStreamProducer` 的最后一道 TransformStream 对每个 chunk 做
 *      `JSON.stringify` 前先 `serialize`，superjson 的外层就是它），裸数组行
 *      同样解不开。
 *
 * ## 用法
 *
 * ```ts
 * await stubTrpc(page, {
 *   "task.list": { tasks: [{ id: "a", createdAt: new Date(), … }], total: 1 },
 * });
 * ```
 *
 * 负载就是过程的**返回值本身**（`superjson` 能表示的任何东西）。`Date` / `Map` /
 * `Set` 都由 superjson 的 `meta` 带上（服务端实测同形），客户端能原样还原
 * ——所以不需要手工拼 `meta.values`。
 *
 * **同一个 URL 只能有一个处理器**（`page.route` 后注册者**先**被调用、它对不认识的
 * URL `continue()` 会把请求直接放去网络，先注册那条根本没机会应答）：所有过程一次
 * 登记在同一个 map 里，不要分两次调用。
 */
export function trpcJsonlBody(results: unknown[]): string {
  const head: Record<string, unknown> = {};
  const lines: string[] = [];
  let chunkId = 0;

  /* 每一行都是 `superjson.serialize(整行)` 的外壳 —— 服务端 `jsonlStreamProducer`
   * 的最后一道 TransformStream 就是这么做的（`serialize(chunk)` 之后才
   * `JSON.stringify`），所以 `meta.values` 的路径是**相对整行**的
   * （实测：`{"json":[2,0,[[{"tasks":…}]]],"meta":{"values":{"2.0.0.tasks.0.createdAt":["Date"]}}}`）。
   * 只序列化内层数据再拼回 `[chunkId, status, …]` 会把 Date 的路径前缀丢掉，
   * 客户端还原出来的 `createdAt` 就还是字符串。 */
  const line = (value: unknown) => JSON.stringify(superjson.serialize(value));

  results.forEach((result, index) => {
    const batchIndex = String(index);
    /* head 的每个槽位指向一段 chunk 定义。`[[0], [null, 0, chunkId]]` 是
     * 「promise 类型（type=0）的异步值，去 0 号流读」—— 服务端 `encode()` 对
     * promise 返回的正是 `[[placeholder], [null, ...reg]]`。 */
    head[batchIndex] = [[0], [null, 0, chunkId]];

    /* 槽位 → `result`：服务端把 `{result: Promise.resolve({data: iterable})}`
     * 的两层 promise 也 encode 成了异步值，所以这里同样要递进两段。 */
    lines.push(
      line([chunkId, 0, [[{ result: 0 }], ["result", 0, chunkId + 1]]]),
    );
    lines.push(
      line([chunkId + 1, 0, [[{ data: 0 }], ["data", 0, chunkId + 2]]]),
    );
    /* 最后一段是真数据。`[[data]]` 是 「值 + 零个 asyncProp」的形状
     * （消费端 `decode(value)` 取 `value[0][0]` 当数据、余下当挂载项）。 */
    lines.push(line([chunkId + 2, 0, [[result]]]));
    chunkId += 3;
  });

  return [line(head), ...lines].join("\n") + "\n";
}

/**
 * 挂 `/api/trpc/**` 桩，把命中过程的响应做成真协议形态（JSON Lines）。
 *
 * @param page Playwright page
 * @param handlers 过程名片段 → 返回值。按 `Object.entries` 顺序**先匹配先赢**，
 *   所以片段要写得够具体（`"setting.get"` 而不是 `"setting"`）。
 *   没命中任何片段时 `route.continue()`，请求照旧打到真实服务端。
 */
export async function stubTrpc(
  page: Page,
  handlers: Record<string, unknown>,
): Promise<void> {
  await page.route("**/api/trpc/**", async (route: Route) => {
    const url = route.request().url();
    const matched = Object.entries(handlers).find(([procedure]) =>
      url.includes(procedure),
    );
    if (!matched) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      /* 与真服务端同头：`application/jsonl` 是**请求**头的协商值，
       * 响应头仍是 `application/json`（`resolveResponse` 里
       * `headers.set("content-type", "application/json")` 那一行），体是 chunked。 */
      contentType: "application/json",
      body: trpcJsonlBody([matched[1]]),
    });
  });
}
