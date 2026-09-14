// @vitest-environment jsdom
/**
 * 工作流库左右分栏的**窄屏适配**回归（用户口径：「小屏幕看不到最右侧的内容」）。
 *
 * 两个成因，缺一个都还会被裁掉：
 *   ① 详情面板是弹性项，没有 `min-w-0` 时 `min-width: auto` 会让它**不肯窄于
 *      内容的最小宽度**（面板里的画布预览、卡片列都不小）→ 整行比窗口宽，右侧
 *      连同头部按钮被根容器的 `overflow-hidden` 裁掉；
 *   ② 头部那一排按钮组此前 `shrink-0` 且外层不换行 → 面板一窄就被挤出去。
 *
 * 因此这里同时锁住「面板能变窄」与「按钮组会换行且换行后仍靠右」。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowRow } from "./workflow-library-config";
import type { MetaEditorController } from "./hooks/use-workflow-library-detail";
import { DetailHeader } from "./sections/DetailHeader";

afterEach(cleanup);

const meta: MetaEditorController = {
  modes: ["T2I"],
  defaultMode: "T2I",
  modelTags: [],
  allModelTags: [],
  busy: false,
  patchModes: async () => undefined,
  patchModelTags: async () => undefined,
  patchSeedMode: async () => undefined,
  patchParamMap: async () => undefined,
};

function renderHeader() {
  render(
    <DetailHeader
      workflow={
        {
          id: "wf-1",
          name: "image_z_image_int8_t2i",
          taskType: "T2I",
          source: "local",
          modes: ["T2I"],
          defaultMode: "T2I",
          modelTags: [],
        } as unknown as WorkflowRow
      }
      usable
      canResync={false}
      missing={false}
      isTechnical={false}
      busyDownload={false}
      busyResync={false}
      meta={meta}
      onEdit={vi.fn()}
      onResync={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      onOpenSource={vi.fn()}
      onUse={vi.fn()}
    />,
  );
}

describe("详情头部：窄屏不丢按钮", () => {
  it("标题区与按钮组同排且都允许换行，换行后按钮组仍靠右", () => {
    renderHeader();
    const row = screen.getByTestId("detail-header-row");
    /* 整行可换行：装不下时按钮组整组落到第二行，而不是溢出被裁。 */
    expect(row.className).toContain("flex-wrap");

    const actions = screen.getByTestId("detail-actions");
    /* 组内也能换行（窄到一行都放不下时按钮分多行，仍然全都点得到）。 */
    expect(actions.className).toContain("flex-wrap");
    /* `ml-auto`：独占第二行时靠右，不被父级 `justify-between` 推到左边。 */
    expect(actions.className).toContain("ml-auto");
    /* 按钮不许被压扁 —— 让位的是标题区，不是按钮。 */
    expect(actions.className).not.toContain("shrink-0");
  });

  it("标题区有可读下限（压缩压力交给它，标题截断而不是把按钮挤出去）", () => {
    renderHeader();
    expect(screen.getByTestId("detail-title-block").className).toContain(
      "min-w-[180px]",
    );
  });
});

describe("左右分栏：详情面板能窄于内容最小宽度", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

  it("详情面板带 min-w-0 + overflow-hidden，列表侧栏固定不缩", () => {
    /* 少了 `min-w-0`，`flex-1` 的自动最小尺寸会让面板撑破窗口宽度，
     * 右侧内容被裁 —— 这正是「小屏幕看不到最右侧」的成因。 */
    const library = read("WorkflowLibrary.tsx");
    expect(library).toMatch(/min-w-0 flex-1 overflow-hidden/);
    /* 宽度压力全给详情面板：列表是固定宽侧栏，不参与收缩（否则两边都变形）。 */
    expect(read("WorkflowLibraryList.tsx")).toMatch(/w-80 shrink-0 flex-col/);
  });

  it("拆分文件确实存在（防止上面的源码断言读到空内容而静默全绿）", () => {
    expect(existsSync(path.join(ROOT, "WorkflowLibrary.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "WorkflowLibraryList.tsx"))).toBe(true);
  });
});
