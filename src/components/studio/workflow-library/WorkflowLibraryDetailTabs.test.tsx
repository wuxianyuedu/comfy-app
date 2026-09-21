// @vitest-environment jsdom
//
// 详情面板页签走 `ui/tabs` 基元的契约（ISSUE #672 / 规范 16 §16.2.4.6 第一档）。
//
// 此前这里是自绘 `TabButton`：手写 `h-auto rounded-none` 的按钮 + 靠
// `active` 条件渲染一条 `absolute inset-x-3 bottom-0 h-0.5` 渐变指示条，
// 键盘导航 / `role="tablist"` / `aria-selected` / `aria-controls` 全都没有。
// 换成基元后，这些语义由 base-ui 给；本文件钉住「接通了、且没有退回自绘」。

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { DETAIL_TABS } from "./workflow-library-detail-config";

afterEach(cleanup);

const ROOT = path.resolve(__dirname);
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** 视图里那段页签栏的最小复刻（配置与类名逐字取自 WorkflowLibraryDetailView）。 */
function TabHarness({ onValueChange }: { onValueChange?: () => void }) {
  return (
    <Tabs
      value="canvas"
      onValueChange={() => onValueChange?.()}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="border-border-subtle h-auto w-full justify-start gap-1 rounded-none border-b px-4"
      >
        {DETAIL_TABS.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            className="detail-tab-trigger h-auto flex-none rounded-none px-3 py-2.5 text-[12px] font-medium"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {DETAIL_TABS.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          面板：{tab.label}
        </TabsContent>
      ))}
    </Tabs>
  );
}

describe("详情面板页签走 ui/tabs", () => {
  it("全部页签都渲染成 role=tab，标签沿用 DETAIL_TABS", () => {
    render(<TabHarness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      DETAIL_TABS.map((tab) => tab.label),
    );
  });

  it("同一时刻只挂载当前页签的面板", () => {
    render(<TabHarness />);
    expect(screen.getByText("面板：编辑对外参数")).toBeInTheDocument();
    expect(screen.queryByText("面板：工坊封装")).toBeNull();
    expect(screen.queryByText("面板：源文件")).toBeNull();
  });

  it("点击别的页签会把选中态交给基元（onValueChange 被调用）", () => {
    const onValueChange = vi.fn();
    render(<TabHarness onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "工坊封装" }));
    expect(onValueChange).toHaveBeenCalled();
  });

  it("视图里不再有自绘页签按钮，页签栏走基元", () => {
    const view = read("WorkflowLibraryDetailView.tsx");
    expect(view).toMatch(/from "~\/components\/ui\/tabs"/);
    expect(view).toMatch(/<TabsList/);
    expect(view).toMatch(/<TabsTrigger/);
    expect(view).not.toMatch(/<TabButton/);
  });

  it("TabButton 已从 DetailControls 删除（不留平行实现）", () => {
    expect(read("sections/DetailControls.tsx")).not.toMatch(
      /export function TabButton/,
    );
  });

  it("选中指示条的颜色只有一个出口（token 渐变，不写死调色板）", () => {
    const css = readFileSync(
      path.resolve(ROOT, "../../../app/globals.css"),
      "utf8",
    );
    const block = /\.detail-tab-trigger::after \{[\s\S]*?\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block?.[0]).toMatch(/var\(--color-primary\)/);
    expect(block?.[0]).toMatch(/var\(--color-accent\)/);
  });
});
