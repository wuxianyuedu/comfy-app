import superjson, { type SuperJSONResult } from "superjson";
import { describe, expect, it } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";

import { planStubResults, trpcJsonlBody } from "../e2e/support/trpc-stub";

/**
 * 锁住 E2E 的 tRPC 桩产出**真协议形态**（ISSUE #1442）。它的失效方式是**静默**的：#1442 现场是四种信封形状行为一致、坏 JSON 一样、控制台零报错，对不上协议时界面照旧显示真数据（或空态），没有东西变红。
 * 判据两层缺一不可：① 形状 —— 首行是 head（按 batchIndex 索引的对象），其后每行必须是 `{"json": …}` 信封（服务端 `jsonlStreamProducer` 的 `serialize` + `JSON.stringify`）；
 * ② 真消费 —— 用 `@trpc/server` 的 `jsonlStreamConsumer` 真读一遍，出处是**跑测试时装的那份依赖**，tRPC 升级换协议会在这里变红，而不是等某条 e2e 变成「数据没进去」的假绿。
 */

/** 桩里出现的负载：含 `Date`（superjson 要靠 `meta` 路径还原）。 */
const payload = {
  tasks: [{ id: "a", createdAt: new Date("2026-01-01T00:00:01Z") }],
  total: 1,
};

/**
 * 用**真消费者**读一遍桩的产出，返回 head。`deserialize` 传 `superjson.deserialize` 而非恒等函数：
 * 施加点是 `createConsumerStream` 的 `JSON.parse(line)` **之后、往 head/chunk 分派之前**，即逐**行**解信封，
 * 正是 `httpBatchStreamLink` 传 `transformer.output.deserialize` 那层；传恒等函数时 `{json, meta}` 原样漏进下游，head 槽位就不是结果信封。
 */

async function consume(body: string) {
  const { jsonlStreamConsumer } = await import("@trpc/server/unstable-core-do-not-import");
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
    deserialize: (v: SuperJSONResult): unknown => superjson.deserialize(v),
    abortController: new AbortController(),
  });
  if (!isRecord(head)) {
    throw new Error("head 不是对象");
  }
  return head;
}

/** 拆开「两层异步值」拿到 `result.data`（协议形状，与客户端同一次拆解）。 */
async function unwrap(slot: unknown) {
  const envelope: unknown = await Promise.resolve(slot);
  if (!isRecord(envelope) || !("result" in envelope)) {
    throw new Error("信封缺 result");
  }
  const result: unknown = await Promise.resolve(envelope.result);
  if (!isRecord(result) || !("data" in result)) {
    throw new Error("信封缺 data");
  }
  return Promise.resolve(result.data);
}

/** 桩负载的形状守卫（B5 清账）：`unknown` → 桩里那份负载的类型。 */
/** 桩负载的形状守卫（B5 清账）：`unknown` → 桩里那份负载的类型。 */
function isPayload(value: unknown): value is typeof payload {
  return isRecord(value) && isUnknownArray(value.tasks);
}

describe("e2e tRPC 桩产出真 JSON Lines 协议", () => {
  it("第一行是 head（按 batchIndex 索引），其后每行都是 json 信封", () => {
    const lines = trpcJsonlBody([payload]).trim().split("\n");
    expect(lines).toHaveLength(4);

    const [firstLine, ...rest] = lines;
    const head: unknown = JSON.parse(firstLine ?? "");
    if (!isRecord(head) || !isRecord(head.json)) {
      throw new Error("head 行不是对象");
    }
    expect(Object.keys(head.json)).toEqual(["0"]);

    for (const line of rest) {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) {
        throw new Error("json 信封行不是对象");
      }
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
    const [first] = isPayload(data) ? data.tasks : [];
    expect(first?.createdAt).toBeInstanceOf(Date);
    expect(first?.createdAt.toISOString()).toBe("2026-01-01T00:00:01.000Z");
  });

  it("多槽（批量）时按 batchIndex 各归各位", async () => {
    const head = await consume(trpcJsonlBody([{ a: 1 }, { b: 2 }]));
    expect(await unwrap(head[0])).toEqual({ a: 1 });
    expect(await unwrap(head[1])).toEqual({ b: 2 });
  });
});

describe("stubTrpc 的批请求对齐（§11.8 的录制输入面依赖它）", () => {
  /* 这条是**实测**出来的缺口：canvas 屏会发
     `/api/trpc/workflow.list,workflowModel.list` —— 一个 URL 两个过程。只回一个结果时
     第二个过程的槽位解成 `undefined`，**不抛错**（与文件头那两条同源）。 */

  it("单发请求回一个结果", () => {
    expect(
      planStubResults("http://x/api/trpc/model.list?batch=1&input=%7B%7D", {
        "model.list": { models: [] },
      }),
    ).toEqual([{ models: [] }]);
  });

  it("批请求按 URL 里的过程顺序给结果（顺序反了就是喂错数据）", () => {
    const handlers = {
      "workflow.list": { workflows: [], total: 0 },
      "workflowModel.list": { tags: [] },
    };
    expect(
      planStubResults(
        "http://x/api/trpc/workflow.list,workflowModel.list?batch=1&input=%7B%7D",
        handlers,
      ),
    ).toEqual([{ workflows: [], total: 0 }, { tags: [] }]);
  });

  it("批请求里有一个过程没有主 → 整条不管（半桩比不桩更坏）", () => {
    expect(
      planStubResults("http://x/api/trpc/workflow.list,workflowModel.list?batch=1&input=%7B%7D", {
        "workflow.list": { workflows: [], total: 0 },
      }),
    ).toBeNull();
  });

  it("不在 /api/trpc/ 下的请求不管", () => {
    expect(planStubResults("http://x/api/comfy/stats", {})).toBeNull();
  });
});
