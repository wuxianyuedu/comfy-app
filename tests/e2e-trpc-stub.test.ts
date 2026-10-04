import superjson, { type SuperJSONResult } from "superjson";
import { describe, expect, it } from "vitest";

import { trpcJsonlBody } from "../e2e/support/trpc-stub";

/**
 * 锁住 E2E 的 tRPC 桩产出**真协议形态**（ISSUE #1442）。
 *
 * 为什么值得一条机器判据：那个 helper 的失效方式是**静默**的 —— ISSUE #1442 的
 * 现场正是「四种信封形状行为完全一致、坏 JSON 也一样、控制台零报错」，桩产出的
 * 东西对不上协议时界面只是照旧显示真数据（或空态），没有任何东西变红。
 * 所以这里把「喂进去」这件事本身钉成可失败断言。
 *
 * 判据分两层，缺一不可：
 *   1. **形状**：第一行是 head（按 batchIndex 索引的对象），其后每行都必须是
 *      `{"json": …}` 信封（服务端 `jsonlStreamProducer` 的 `serialize` + `JSON.stringify`）；
 *   2. **真消费**：拿 `@trpc/server` 的 `jsonlStreamConsumer` 真读一遍 —— 这层的
 *      出处是**跑测试时安装的那份依赖**，所以 tRPC 升级换了协议会在这里变红，
 *      而不是等到某条 e2e 变成「数据没进去」的假绿。
 */

/** 桩里出现的负载：含 `Date`（superjson 要靠 `meta` 路径还原）。 */
const payload = {
  tasks: [{ id: "a", createdAt: new Date("2026-01-01T00:00:01Z") }],
  total: 1,
};

/**
 * 用**真消费者**读一遍桩的产出，返回 head。
 *
 * `deserialize` 位传 `superjson.deserialize` 而不是恒等函数：它的施加点是
 * `createConsumerStream` 的 `JSON.parse(line)` **之后、往 head/chunk 分派之前**
 * （`jsonlStreamConsumer` 里那个 TransformStream），也就是逐**行**解信封 ——
 * 这正是 `httpBatchStreamLink` 传 `transformer.output.deserialize` 的那一层。
 * 传恒等函数时 `{json, meta}` 会原样漏进下游，head 的槽位就不是结果信封了。
 */
async function consume(body: string) {
  const { jsonlStreamConsumer } =
    await import("@trpc/server/unstable-core-do-not-import");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  const [head] = await jsonlStreamConsumer({
    from: stream,
    /* 与客户端 `resolvedOpts.transformer.output.deserialize` 同源。逐行解
       `{json, meta}` 信封，所以传 `superjson.deserialize` 而不是恒等函数。 */
    /* `superjson.deserialize` 的签名要求 `SuperJSONResult`；这一层的入参在
       tRPC 侧是 `any`，所以显式收一次口，返回 `unknown` 交给下游自己拆。 */
    deserialize: (v: unknown): unknown =>
      superjson.deserialize<SuperJSONResult>(v as SuperJSONResult),
    abortController: new AbortController(),
  });
  return head as Record<number, unknown>;
}

/** 拆开「两层异步值」拿到 `result.data`（协议形状，与客户端同一次拆解）。 */
async function unwrap(slot: unknown) {
  const envelope = (await Promise.resolve(slot)) as { result: unknown };
  const result = (await Promise.resolve(envelope.result)) as { data: unknown };
  return Promise.resolve(result.data);
}

describe("e2e tRPC 桩产出真 JSON Lines 协议", () => {
  it("第一行是 head（按 batchIndex 索引），其后每行都是 json 信封", () => {
    const lines = trpcJsonlBody([payload]).trim().split("\n");
    expect(lines).toHaveLength(4);

    const [firstLine, ...rest] = lines;
    const head = JSON.parse(firstLine!) as { json: Record<string, unknown> };
    expect(Object.keys(head.json)).toEqual(["0"]);

    for (const line of rest) {
      const parsed = JSON.parse(line) as { json?: unknown };
      expect("json" in parsed).toBe(true);
      /* 不能是裸数组：裸行的 `type` 会落空 → 槽位静默变 undefined。 */
      expect(Array.isArray(parsed)).toBe(false);
    }
  });

  it("body 以换行结尾（逐行切分要读到最后一行）", () => {
    expect(trpcJsonlBody([payload]).endsWith("\n")).toBe(true);
  });

  it("jsonlStreamConsumer 真读得出来，且 Date 被还原（不是字符串）", async () => {
    const head = await consume(trpcJsonlBody([payload]));
    const data = await unwrap(head[0]);

    expect(data).toEqual(payload);
    /* `createdAt` 过线之后仍然是 `Date`（superjson 的 meta 路径带对了）；
     * 丢了 meta 时这里是字符串，而客户端 `row.createdAt.getTime()` 会抛
     * `is not a function` —— 真现场见 ISSUE #1442 的复现步骤。 */
    const [first] = (data as typeof payload).tasks;
    expect(first?.createdAt).toBeInstanceOf(Date);
    expect(first?.createdAt.toISOString()).toBe("2026-01-01T00:00:01.000Z");
  });

  it("多槽（批量）时按 batchIndex 各归各位", async () => {
    const head = await consume(trpcJsonlBody([{ a: 1 }, { b: 2 }]));
    expect(await unwrap(head[0])).toEqual({ a: 1 });
    expect(await unwrap(head[1])).toEqual({ b: 2 });
  });
});
