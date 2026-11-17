// 探活地址选取的判据测试（ISSUE #4195）。
//
// 探活与业务轮询共享浏览器按 host 分桶的连接池；页面挂在 loopback 名上时改打
// 127.0.0.1 才能拿到独立连接池。这里的每一条都对应一种真实部署形态：
//   · localhost / ::1 来源（壳与浏览器的常态）→ 换 127.0.0.1；
//   · 页面本就在 127.0.0.1 上 → 没有更优桶，维持同源相对地址；
//   · 局域网来源 → 127.0.0.1 未必是本应用，不冒然换目标；
//   · 无端口 / 非法来源 → 不猜，退回相对地址。

import { describe, expect, it } from "vitest";

import { devServerProbeUrl } from "./dev-server-probe-url";

describe("devServerProbeUrl — 探活走另一张环回卡", () => {
  it("localhost 来源改打 127.0.0.1（同端口、同路径）", () => {
    expect(devServerProbeUrl("http://localhost:3797/workspace")).toBe(
      "http://127.0.0.1:3797/api/dev/server-id",
    );
  });

  it("::1 来源同样改打 127.0.0.1（IPv6 方括号要剥掉）", () => {
    expect(devServerProbeUrl("http://[::1]:3797/")).toBe("http://127.0.0.1:3797/api/dev/server-id");
  });

  it("页面本就在 127.0.0.1 上：维持同源相对地址（没有更优的桶）", () => {
    expect(devServerProbeUrl("http://127.0.0.1:3797/workspace")).toBe("/api/dev/server-id");
  });

  it("非环回来源（局域网访问）：维持相对地址，不冒然换目标", () => {
    expect(devServerProbeUrl("http://192.168.1.5:3797/")).toBe("/api/dev/server-id");
  });

  it("无端口来源：不是本应用的部署形态，维持相对地址", () => {
    expect(devServerProbeUrl("https://localhost/")).toBe("/api/dev/server-id");
  });

  it("缺失或非法来源：退回同源相对地址，行为与旧版一致", () => {
    expect(devServerProbeUrl(undefined)).toBe("/api/dev/server-id");
    expect(devServerProbeUrl("")).toBe("/api/dev/server-id");
    expect(devServerProbeUrl("not-a-url")).toBe("/api/dev/server-id");
  });
});
