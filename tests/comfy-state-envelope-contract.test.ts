// @vitest-environment jsdom
/**
 * comfy state 长轮询通道的**信封契约**（台账 E4 第三格）：生产侧记下的那笔与消费侧交给订阅者的那笔必须同一形状。原先两边各测各的
 * （客户端用手写 `change()` 夹具，路由用 `toMatchObject({seq, kind})` 只点两列），任一字段改名另一侧只会**静默丢帧**（`parseChange` 认不出→`null`→`pollOnce` 当没变化，界面「状态不再即时更新」），tsc/eslint/两侧用例/覆盖率全绿。
 * 做法：真路由接真客户端，① 交出的与记下的 `toEqual`（挡少一列与多要求一列）；② 线上把 `detail` 改名时消费侧**一帧都不交**（否则①可被「两边都不读 detail」满足）。mock 边界只有 `fetch`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "~/app/api/comfy/state/route";
import {
  resetComfyStateClientForTest,
  subscribeComfyStateChanges,
} from "~/lib/comfy/comfy-state-client";
import type { ComfyStateChange } from "~/lib/comfyui/state-watch";
import { noteComfyStateChange, resetComfyStateWatchForTest } from "~/lib/comfyui/state-watch";

/** 客户端写的是相对 URL，而路由读的是 `new URL(request.url)` —— 不补成绝对形式，
 *  那一句会直接抛（然后被客户端的 catch 吞成「这一轮没有变化」，表现是永远收不到帧）。 */
const BASE = "http://127.0.0.1:3000";

/** 把真路由的回答喂给客户端；`mutate` 用来造「线上漂了」那一格。 */
function wireClientToRealRoute(
  mutate?: (frame: Record<string, unknown>) => Record<string, unknown>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = new URL(String(url), BASE).href;
      /* 只给 `url` 一个字段就够：路由读的就是它。
       * 不构造 `Request` 是为了不让这一格依赖 jsdom 那侧有没有 fetch 家族的全局。 */
      /* SAFETY: 类型断言已复核 */
      const res = await GET({ url: href } as unknown as Request);
      if (res.status !== 200) {
        return res;
      }
      /* SAFETY: 类型断言已复核 */
      const frame = (await res.clone().json()) as Record<string, unknown>;
      return new Response(JSON.stringify(mutate ? mutate(frame) : frame), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** 让在途那一拍跑完（长轮询链是「请求完成 → 立刻再发」）。 */
async function settle(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** 等到条件成立（最多若干轮），不等就按失败处理 —— 不靠「赌一拍够不够」。 */
async function settleUntil(condition: () => boolean, rounds = 50): Promise<boolean> {
  for (let i = 0; i < rounds; i += 1) {
    await settle(1);
    if (condition()) {
      return true;
    }
  }
  return false;
}

beforeEach(() => {
  resetComfyStateClientForTest();
  resetComfyStateWatchForTest();
});

afterEach(() => {
  resetComfyStateClientForTest();
  resetComfyStateWatchForTest();
  vi.unstubAllGlobals();
});

describe("comfy state 的信封：生产侧那一笔 == 消费侧那一笔", () => {
  it("真路由发的一帧，客户端原样交给订阅者（四个字段一个都不能差）", async () => {
    wireClientToRealRoute();
    const produced = noteComfyStateChange("ready", "ComfyUI 已就绪", 1234);

    const delivered: Array<ComfyStateChange> = [];
    const off = subscribeComfyStateChanges((change) => delivered.push(change));
    expect(await settleUntil(() => delivered.length === 1)).toBe(true);

    /* 这一条就是「两边接起来跑一次」的全部价值：`toEqual` 判的是键集与值同时相等，
     * 所以生产侧少发一列、或消费侧多要求一列，都会在这里红 —— 而两边各自的用例
     *（`toMatchObject` 只点两列 / 手写夹具只写那四列）对这两种漂移都没有反应。 */
    expect(delivered[0]).toEqual(produced);
    off();
  });

  it("线上把 `detail` 改名 → 一帧都不交，而不是交出一个半成品", async () => {
    /* 反向证明。漂移最常见的形状就是改名：这里只改**线上**那一份，两边代码都不动 ——
     * 今天的消费侧会把这一帧判成坏帧丢掉。丢掉本身是可接受的（兜底是那次重新问状态），
     * **不可接受**的是它交出一个 `detail: undefined` 的对象还让链继续跑。 */
    wireClientToRealRoute(({ detail, ...rest }) => ({
      ...rest,
      message: detail,
    }));
    noteComfyStateChange("ready", "ComfyUI 已就绪", 1234);

    const delivered: Array<ComfyStateChange> = [];
    const off = subscribeComfyStateChanges((change) => delivered.push(change));
    await settle(6);
    expect(delivered).toEqual([]);
    off();
  });

  it("连续两笔都按原样送到：纪元与去重跨真路由仍然成立", async () => {
    wireClientToRealRoute();
    const first = noteComfyStateChange("start", "启动动作落了锁", 1000);

    const delivered: Array<ComfyStateChange> = [];
    const off = subscribeComfyStateChanges((change) => delivered.push(change));
    expect(await settleUntil(() => delivered.length === 1)).toBe(true);

    /* 第二笔在**第一拍已经回到客户端之后**才发生：路由那侧的等待必须被这一笔唤醒，
     * 而客户端那侧必须认它是更新的一纪元（`seq` 去重把它当新事件）。
     * 这一段走的是真 `waitForComfyStateChange`，不是替身 —— 替身永远测不到
     * 「挂起的等待被后来的一笔唤醒」这条。 */
    const second = noteComfyStateChange("exit", "进程退出落定", 2000);
    expect(await settleUntil(() => delivered.length === 2)).toBe(true);

    expect(delivered).toEqual([first, second]);
    expect(delivered.map((c) => c.seq)).toEqual([first.seq, second.seq]);
    off();
  });

  it("消费侧读的是 `seq`/`at`/`kind`/`detail` 这四列（把「读哪几列」这件事本身钉住）", async () => {
    /* 这份清单与上面那条不重复：上面判「两边相等」，这一条判**相等的是哪四列**。
     * 少了它，两边一起把某一列删掉（今天 `kind` 就没有第二个消费点）也是一片绿。 */
    wireClientToRealRoute();
    const produced = noteComfyStateChange("config", "配置写入", 3000);
    expect(Object.keys(produced).sort()).toEqual(["at", "detail", "kind", "seq"]);

    const delivered: Array<ComfyStateChange> = [];
    const off = subscribeComfyStateChanges((change) => delivered.push(change));
    expect(await settleUntil(() => delivered.length === 1)).toBe(true);
    expect(Object.keys(delivered[0]!).sort()).toEqual(["at", "detail", "kind", "seq"]);
    off();
  });
});
