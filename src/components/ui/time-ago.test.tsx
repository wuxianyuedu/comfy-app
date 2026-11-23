// TimeAgo 的水合安全口径（ISSUE #4852）：SSR 输出是**稳定占位**（不含随墙钟
// 漂移的相对时间），挂载后才显示真实相对时间 —— 文案差异发生在挂载之后，
// 不再触发「Hydration failed ⇒ 整树客户端重生成」。
// 说明：RTL 的 render() 在 act 里同步冲刷 effect，「客户端首帧」无法用它观察；
// 首帧同形由实现构造保证（mounted 在 effect 前恒为 false），这里钉两头的读数。
import { renderToString } from "react-dom/server";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TimeAgo } from "./time-ago";

afterEach(cleanup);

/** 5 分钟前的时刻（相对时间断言只认「分钟前」档，不钉具体数字 —— 墙钟在走）。 */
const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60_000).toISOString();

describe("TimeAgo —— 相对时间的水合安全口径（ISSUE #4852）", () => {
  it("SSR 输出是稳定占位：与「刚刚」同形，不含随墙钟漂移的相对时间", () => {
    const ssr = renderToString(<TimeAgo value={fiveMinutesAgo()} />);
    expect(ssr).toContain("刚刚");
    expect(ssr).not.toContain("分钟前");
  });

  it("挂载后显示真实相对时间（占位只存在于一帧）", async () => {
    const view = render(<TimeAgo value={fiveMinutesAgo()} />);
    await waitFor(() => {
      expect(view.container.textContent).toContain("分钟前");
    });
  });

  it("suffix / fallback / maxDays 透传 timeAgo（null 时落兜底文案）", async () => {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const view = render(<TimeAgo fallback="时间未知" maxDays={7} suffix="修改" value={monthAgo} />);
    await waitFor(() => {
      expect(view.container.textContent).toBe("时间未知");
    });
  });
});
