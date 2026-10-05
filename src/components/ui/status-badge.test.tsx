import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

afterEach(cleanup);

/**
 * 状态徽章的判据（ISSUE #672 / 规范 16 §16.2.4.5）。
 *
 * 状态色此前在**七个文件**各写一份字面量（任务历史 / 执行日志 ×2 /
 * 项目产出 / 画布节点 / 自定义节点设置 ×2 / 工坊三处）—— 同一个「已完成」
 * 在不同界面是 `emerald-500/15` / `emerald-400/10` / `emerald-100`，
 * 改一次状态色要点七遍名。本文件把「配色只有一处」钉住：
 *
 *   ① 常见状态键都有配色，且**互不相同**（否则状态不可分辨）；
 *   ② 配色一律是语义 token 类名，不落 Tailwind 原生调色板字面量；
 *   ③ 未知状态回退中性档，不会渲染成无色；
 *   ④ `dot` 形态可关（叠在媒体上的角标）。
 *
 * 文案**不在本文件**：同一个状态在不同界面叫法不同（任务历史「已完成」/
 * 画布节点「运行后生成」/ 镜头「片段就绪」），那是业务文案。
 */
const KNOWN = [
  "SUCCEEDED",
  "RUNNING",
  "QUEUED",
  "FAILED",
  "CANCELLED",
  "IDLE",
] as const;

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
    render(<StatusBadge status={status} className="bg-x" />);
    const cls = badgeClass(status);
    expect(cls).not.toMatch(
      /\b(bg|text|border)-(?:violet|red|rose|emerald|amber|cyan|sky|fuchsia|purple|green|blue)-\d/,
    );
  });

  it("状态键大小写不敏感（画布用小写词，服务端给大写）", () => {
    render(
      <>
        <StatusBadge status="succeeded" label="小写" />
        <StatusBadge status="SUCCEEDED" label="大写" />
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
    const { container: withoutDot } = render(
      <StatusBadge status="RUNNING" dot={false} />,
    );
    expect(withDot.querySelectorAll("span").length).toBe(
      withoutDot.querySelectorAll("span").length + 1,
    );
  });

  it("label 覆盖显示文案（配色仍随 status）", () => {
    render(
      <>
        <StatusBadge status="DONE" dot={false} />
        <StatusBadge status="DONE" label="运行后生成" dot={false} />
      </>,
    );
    expect(badgeClass("运行后生成")).toBe(badgeClass("DONE"));
  });
});
