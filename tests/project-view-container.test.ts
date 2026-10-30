/**
 * 「项目内视图收进统一容器」这条约定的执行者。
 *
 * 收口做完如果不配判据，下一个视图会照着旁边那个文件的写法再手抄一遍 div，
 * 两周后形状又变成八份。所以这里判的不是「容器对不对」（那由
 * `src/components/studio/ViewContainer.test.tsx` 在 DOM 上判），而是
 * **视图有没有绕开容器**：
 *   · 清单里的视图必须真的引了容器；
 *   · 视图源码里不许再出现手写的「外层滚动 + 居中列 + 宽度上限」那一串；
 *   · 传给容器的 `className` 里不许写 `max-w-*`（宽度只从 `width` 档位进来；
 *     两份类并存时谁生效取决于样式表顺序，那是未定义行为）；
 *   · 传给容器的 `className` 里必须带**无变体的左右内边距**（`px-*`）—— 容器
 *     刻意不管内边距（那是布局决定，见 `ViewContainer` 文件头），于是漏写的表现
 *     不是报错而是**内容贴死容器边缘**：窗口窄到 `max-w-wide` 不封顶时，居中列
 *     就等于整条滚动区的宽度，左右留白一起归零。
 *
 * 判源码而不是判渲染结果：这些是「别再手写」的约束，渲染结果判不出「有人手写」。
 * 工作区型那一半（画布 / 成片 / 工坊 / 工作流库）随它那一刀一起进来。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const STUDIO = path.join("src", "components", "studio");

/** 已收口的文档型视图。新增同类视图时先加进这张表（漏加会被下面的存在性判据问住）。 */
const DOCUMENT_VIEWS = [
  path.join(STUDIO, "HomePage.tsx"),
  path.join(STUDIO, "project-home", "ProjectHomePage.tsx"),
  path.join(STUDIO, "WorksGallery.tsx"),
  path.join(STUDIO, "ModelLibrary.tsx"),
  path.join(STUDIO, "history", "HistoryList.tsx"),
  path.join(STUDIO, "queue", "QueueMonitorView.tsx"),
  path.join(STUDIO, "library", "ResourceLibrary.tsx"),
  path.join(STUDIO, "ProjectOutputs.tsx"),
  // 这三屏是「浮层入口 → 视图」那一批改出来的，收口时漏登记，所以它们各自漏掉的
  // 约定（左右内边距）在这里第一次有了执行者。
  path.join("src", "components", "console", "ConsoleView.tsx"),
  path.join("src", "components", "workshop", "ModelAdaptersView.tsx"),
];

/** 已收口的工作区型视图。
 *
 * 画布（`ProjectCanvas`）与成片（`FilmStudio`）**刻意不在清单上**，各有各的理由，
 * 两处都不是「顺手改一下」：
 *   · 成片根上挂着一层 `absolute inset-0` 的光斑，它现在锚的是更外层的定位祖先；
 *     容器带 `relative`，套上去会让那层改锚到外框（少盖住页签条那一条）——
 *     这是外观决定，得单独看；
 *   · 画布那一层是 ReactFlow 的尺寸父级兼拖放目标（`onDragOver` / `onDrop` 在它身上），
 *     它没有重复的形状可收，套壳只是多一层。
 */
const WORKSPACE_VIEWS = [
  path.join(STUDIO, "workflow-library", "WorkflowLibrary.tsx"),
  path.join("src", "components", "workshop", "WorkshopPipeline.tsx"),
  /* 这一屏从文档型挪到工作区型：换壳是布局决定（模式清单收成左侧树形页签之后，
     文档型那层「整屏一条滚动条 + 居中窄栏」会让树随正文一起被推走、且没有可依附的
     定高边界），见 `ModeContractView.tsx` 文件头（ISSUE #1870 / #1871）。
     于是上面那条「传给容器的 className 必须带无变体 `px-`」对它**不再适用**，而不是
     「被豁免」—— 它判的是「居中列没封顶时留白归零」，这一屏没有居中列。留白的归属
     下移到屏内那一层，实测在 `ModeContractEditorView.tsx` 的页眉与两栏容器上
     （`px-4 sm:px-8`），那一层现在自己就是判据看得见的调用点。 */
  path.join("src", "components", "workshop", "mode-contract", "ModeContractView.tsx"),
];

/** 剥注释再判：说明文字里出现 `max-w-300` 不等于有人手写那一层。 */
function codeOf(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), "utf8"));
}

/** 该文件里每一处 `<DocumentFrame …>` 传进去的 `className`（没传则跳过）。 */
function frameClassNamesOf(rel: string): string[] {
  const out: string[] = [];
  for (const m of codeOf(rel).matchAll(/<DocumentFrame\b([\s\S]{0,400}?)>/g)) {
    const className = /className="([^"]*)"/.exec(m[1] ?? "")?.[1];
    if (className !== undefined) out.push(className);
  }
  return out;
}

describe("统一容器的接入约定（文档型）", () => {
  it("清单不为空，且每一项都还在磁盘上（改名/搬走要先同步这张表）", () => {
    // 扫描面为空时，下面那组 it.each 会因为「没人可判」而假绿 —— 先把它钉住。
    expect(DOCUMENT_VIEWS.length).toBeGreaterThanOrEqual(8);
    for (const rel of DOCUMENT_VIEWS) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} 读不到`).toBe(true);
    }
  });

  it.for(DOCUMENT_VIEWS.map((rel) => /* SAFETY: 类型断言已复核 */ [rel] as [string]))(
    "%s 引了容器，且没再手写那一串形状",
    ([rel]) => {
      const code = codeOf(rel);
      expect(code, `${rel} 没用 DocumentFrame`).toContain("DocumentFrame");
      expect(code).not.toMatch(/className="h-full overflow-y-auto"/);
      expect(code).not.toMatch(/mx-auto[^"]*max-w-/);
      expect(code).not.toMatch(/max-w-\d{3}/);
    },
  );

  it("传给容器的 className 里没有第二份宽度", () => {
    const offenders: string[] = [];
    for (const rel of DOCUMENT_VIEWS) {
      if (frameClassNamesOf(rel).some((c) => c.includes("max-w-"))) {
        offenders.push(rel);
      }
    }
    expect(offenders, "这些视图在 className 里写了 max-w").toEqual([]);
  });

  it("传给容器的 className 都带无变体的左右内边距（px-*）", () => {
    /* 只认无变体的 `px-`：`sm:px-8` 在断点以下不生效，而贴边恰恰发生在窗口变窄
       的那一侧 —— 只写带变体的那一半等于没写。 */
    const offenders: string[] = [];
    for (const rel of DOCUMENT_VIEWS) {
      const classNames = frameClassNamesOf(rel);
      /* 前置断言：抽不到 className 时上面那个循环会「没人可判」而假绿 —— 那等于
         这一档对整屏失效，必须当场红，而不是安静放过。 */
      expect(
        classNames.length,
        `${rel} 没被抽出任何 <DocumentFrame> 的 className，判据对它失效`,
      ).toBeGreaterThan(0);
      for (const className of classNames) {
        if (!/(^|\s)px-/.test(className)) {
          offenders.push(`${rel} :: ${className}`);
        }
      }
    }
    expect(offenders, "这些视图把内容铺到了容器边缘：居中列没封顶时左右留白归零").toEqual([]);
  });
});

describe("统一容器的接入约定（工作区型）", () => {
  it("清单不为空，且每一项都还在磁盘上", () => {
    expect(WORKSPACE_VIEWS.length).toBeGreaterThanOrEqual(2);
    for (const rel of WORKSPACE_VIEWS) {
      expect(existsSync(path.join(ROOT, rel)), `${rel} 读不到`).toBe(true);
    }
  });

  it.for(WORKSPACE_VIEWS.map((rel) => /* SAFETY: 类型断言已复核 */ [rel] as [string]))(
    "%s 引了 WorkspaceFrame，且不再自己写几何或页面滚动",
    ([rel]) => {
      const code = codeOf(rel);
      expect(code, `${rel} 没用 WorkspaceFrame`).toContain("WorkspaceFrame");
      /* `min-h-screen` 在壳里等于又开一个视口高：内容一高就出现「壳的滚动条 +
         这一屏的滚动条」双层滚动（工坊屏原先正是这个形状）。 */
      expect(code).not.toMatch(/min-h-screen/);
      // 容器那串几何不许在视图里再抄一遍。
      expect(code).not.toMatch(/className="flex h-full[^"]*flex-col overflow-hidden"/);
    },
  );

  it("调用点不再给工作区型包一层滚动容器（双层滚动的另一半）", () => {
    const page = codeOf(path.join("src", "app", "workspace", "page.tsx"));
    expect(page, "工坊的滚动条归它自己的容器管，调用点再包一层就是两条叠着").not.toMatch(
      /<div className="h-full overflow-y-auto">\s*<WorkshopPipeline/,
    );
  });
});
