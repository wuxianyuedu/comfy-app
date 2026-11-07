/**
 * `toWsBase()` 的协议换算（daily 全量E2E 红根因的回归用例）。
 *
 * 事故形态：回调第二参写成 `{ s }`（命名组对象）→ 实际从第一个捕获组字符串上
 * 解构出 `undefined` → `wsundefined://127.0.0.1:18188/api/ws` → `new WebSocket()`
 * 抛协议错误 → 被 catch 静默重试 → WS 永不就绪 → 队列任务永不领取 → 60s 超时。
 * 这里只钉换算结果，不碰网络。
 */
import { describe, expect, it } from "vitest";

import { toWsBase } from "~/lib/comfyui/client";

describe("toWsBase：http(s) → ws(s)", () => {
  it("http 换成 ws，端口原样保留", () => {
    expect(toWsBase("http://127.0.0.1:18188")).toBe("ws://127.0.0.1:18188");
  });

  it("https 换成 wss", () => {
    expect(toWsBase("https://comfy.example.com:8443")).toBe("wss://comfy.example.com:8443");
  });

  it("大小写不敏感（协议名大小写混写也要换）", () => {
    expect(toWsBase("HTTP://127.0.0.1:8188")).toBe("ws://127.0.0.1:8188");
  });

  it("不含 http(s) 前缀时逐字返回（不制造第二种改写）", () => {
    expect(toWsBase("127.0.0.1:8188")).toBe("127.0.0.1:8188");
    expect(toWsBase("ws://127.0.0.1:8188")).toBe("ws://127.0.0.1:8188");
  });
});
