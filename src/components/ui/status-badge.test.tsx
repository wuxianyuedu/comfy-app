import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

afterEach(cleanup);

/**
 * 状态徽章的判据（ISSUE #672 / 规范 16 §16.2.4.5）。状态色此前在七个文件各写一份字面量，同一个「已完成」在不同界面是三种 emerald 值，改一次要点七遍名。
 * 本文件钉住「配色只有一处」：① 常见状态键都有配色且互不相同；② 一律语义 token、不落原生调色板；③ 未知状态回退中性档；④ `dot` 可关。文案不在本文件：同一状态在不同界面叫法不同，那是业务文案。
 */
/* SAFETY: 类型断言已复核 */
const KNOWN = ["SUCCEEDED", "RUNNING", "QUEUED", "FAILED", "CANCELLED", "IDLE"] as const;

/** 与其他用例同款：从渲染结果里取「那个 span」的类名。 */
function badgeClass(label: string): string {
  const el = screen.getByText(label);
  return el.className;
}

describe("StatusBadge", () => {
  it.for(KNOWN)("status=%s 有配色", (status) => {
    render(<StatusBadge status={status} />);
    expect(badgeClass(status)).toMatch(/\bbg-\S+/);
  });

  it.for(KNOWN)("status=%s 的配色不落原生调色板字面量", (status) => {
    render(<StatusBadge className="bg-x" status={status} />);
    const cls = badgeClass(status);
    expect(cls).not.toMatch(
      /\b(?:bg|text|border)-(?:violet|red|rose|emerald|amber|cyan|sky|fuchsia|purple|green|blue)-\d/,
    );
  });

  it("状态键大小写不敏感（画布用小写词，服务端给大写）", () => {
    render(
      <>
        <StatusBadge label="小写" status="succeeded" />
        <StatusBadge label="大写" status="SUCCEEDED" />
      </>,
    );
    expect(badgeClass("小写")).toBe(badgeClass("大写"));
  });

  it("未知状态回退中性档，不会渲染成无色", () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(badgeClass("SOMETHING_NEW")).toContain("bg-subtle");
  });

  it("缺省带状态圆点；dot={false} 时不带（叠在媒体上的角标）", () => {
    const { container: withDot } = render(<StatusBadge status="RUNNING" />);
    const { container: withoutDot } = render(<StatusBadge dot={false} status="RUNNING" />);
    expect(withDot.querySelectorAll("span").length).toBe(
      withoutDot.querySelectorAll("span").length + 1,
    );
  });

  it("label 覆盖显示文案（配色仍随 status）", () => {
    render(
      <>
        <StatusBadge dot={false} status="DONE" />
        <StatusBadge dot={false} label="运行后生成" status="DONE" />
      </>,
    );
    expect(badgeClass("运行后生成")).toBe(badgeClass("DONE"));
  });
});
