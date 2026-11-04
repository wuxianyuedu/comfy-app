import type { Page, Route } from "@playwright/test";
import superjson from "superjson";

/** tRPC 桩：让 `route.fulfill` 出去的内容**真的进到** `httpBatchStreamLink`（按 JSON Lines 读响应体）
 * —— 第一行是 head（按 `batchIndex` 索引的对象），其后每行是 `[chunkId, status, data]` 的 async chunk，
 * 且必须是 superjson 信封。喂数组错在两处且**都不抛错**（ISSUE #1442：好 JSON 与坏 JSON 表现一致、控制台
 * 零报错）：无换行 ⇒ 整段当 head，`Object.entries` 把信封当 chunk 定义 ⇒ 槽位 undefined；裸数组行亦解不开。
 * 负载即返回值（superjson meta 带 Date/Map/Set）；**同一 URL 只有一个处理器**（后注册者先应答、不认的 URL continue()）⇒ 过程一次登记。 */
export function trpcJsonlBody(results: Array<unknown>): string {
  const head: Record<string, unknown> = {};
  const lines: Array<string> = [];
  let chunkId = 0;

  /* 每一行都是 `superjson.serialize(整行)` 的外壳（服务端 `jsonlStreamProducer` 的最后一道 TransformStream
   * 就是这样：`serialize(chunk)` 后才 `JSON.stringify`），所以 `meta.values` 的路径**相对整行**
   * （实测 `"2.0.0.tasks.0.createdAt":["Date"]`）。只序列化内层数据再拼回外壳会丢掉 Date 的路径前缀，
   * 客户端还原的 `createdAt` 就还是字符串。 */
  const line = (value: unknown) => JSON.stringify(superjson.serialize(value));

  results.forEach((result, index) => {
    const batchIndex = String(index);
    /* head 的每个槽位指向一段 chunk 定义。`[[0], [null, 0, chunkId]]` 是
     * 「promise 类型（type=0）的异步值，去 0 号流读」—— 服务端 `encode()` 对
     * promise 返回的正是 `[[placeholder], [null, ...reg]]`。 */
    head[batchIndex] = [[0], [null, 0, chunkId]];

    /* 槽位 → `result`：服务端把 `{result: Promise.resolve({data: iterable})}`
     * 的两层 promise 也 encode 成了异步值，所以这里同样要递进两段。 */
    lines.push(line([chunkId, 0, [[{ result: 0 }], ["result", 0, chunkId + 1]]]));
    lines.push(line([chunkId + 1, 0, [[{ data: 0 }], ["data", 0, chunkId + 2]]]));
    /* 最后一段是真数据。`[[data]]` 是 「值 + 零个 asyncProp」的形状
     * （消费端 `decode(value)` 取 `value[0][0]` 当数据、余下当挂载项）。 */
    lines.push(line([chunkId + 2, 0, [[result]]]));
    chunkId += 3;
  });

  return `${[line(head), ...lines].join("\n")}\n`;
}

/**
 * 从 `/api/trpc/<一段>` 里取出本次请求的过程名列表。批请求把多个过程名逗号拼在同一段路径（实测
 * `/api/trpc/workflow.list,workflowModel.list`），而**响应体的槽位顺序必须逐一对应** —— 只回一个结果时
 * 第二个过程解成 `undefined` 且**不抛错**（与文件头「好 JSON 与坏 JSON 表现一致」同源）。
 * 不导出：唯一消费者是 {@link stubTrpc}，这条「按顺序对齐」是它的私有契约。@returns 过程名列表（不在 `/api/trpc/` 下为空数组） */
function proceduresOf(rawUrl: string): Array<string> {
  const { pathname } = new URL(rawUrl);
  const prefix = "/api/trpc/";
  if (!pathname.startsWith(prefix)) {
    return [];
  }
  return pathname.slice(prefix.length).split(",").filter(Boolean);
}

/** 一条 tRPC 请求该被回什么 —— `null` 表示「不管它，继续打到真实服务端」。抽成纯函数是为了可判：
 * `stubTrpc` 的失效方式是**静默**的（回错形状前端只是拿不到数据，同 #1442 那族）。规则：URL 里每个过程
 * 都要在 `handlers` 找到一条（`Object.entries` 顺序**先匹配先赢**，片段写具体），按出现顺序给结果数组；
 * **只要有一个没主就整条 `null`** —— 半桩比不桩更坏（另一个过程拿 `undefined` 槽位，静默）。导出即可被
 * `tests/e2e-trpc-stub.test.ts` 直接执行。@returns 对齐结果数组，或 `null`（不该管这条请求） */
export function planStubResults(
  rawUrl: string,
  handlers: Record<string, unknown>,
): Array<unknown> | null {
  const procedures = proceduresOf(rawUrl);
  if (procedures.length === 0) {
    return null;
  }
  const results = procedures.map(
    (procedure) => Object.entries(handlers).find(([name]) => procedure.includes(name))?.[1],
  );
  if (results.some((result) => result === undefined)) {
    return null;
  }
  return results;
}

/** 挂 `/api/trpc/**` 桩，把命中过程的响应做成真协议形态（JSON Lines）。@param page Playwright page；
 * @param handlers 过程名片段 → 返回值，`Object.entries` 顺序**先匹配先赢**，片段写具体（`"setting.get"`
 * 而不是 `"setting"`）；没命中时 `route.continue()`，请求照旧打到真实服务端。⚠️ **批请求按 URL 里的
 * 过程顺序逐一取结果**，**只要有一个过程没有 handler 就整条 `continue()`** —— 半桩比不桩更坏（另一个
 * 过程拿 `undefined` 槽位，静默、不报错，同文件头那两条）。 */
export async function stubTrpc(page: Page, handlers: Record<string, unknown>): Promise<void> {
  await page.route("**/api/trpc/**", async (route: Route) => {
    const url = route.request().url();
    const procedures = proceduresOf(url);
    /* 每个过程都要有主：缺一个就整条继续打到真实服务端（见函数头）。 */
    const results = procedures.map(
      (procedure) => Object.entries(handlers).find(([name]) => procedure.includes(name))?.[1],
    );
    if (results.length === 0 || results.some((r) => r === undefined)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      /* 与真服务端同头：`application/jsonl` 是**请求**头的协商值，
       * 响应头仍是 `application/json`（`resolveResponse` 里
       * `headers.set("content-type", "application/json")` 那一行），体是 chunked。 */
      contentType: "application/json",
      body: trpcJsonlBody(results),
    });
  });
}
