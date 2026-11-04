/**
 * 「一屏一个名字」的源码守卫（ISSUE #1423）：用户反馈主页各屏「很多都有 2 套名字」、标题区因此过大。
 * 收口后只有 `NavItems.tsx` 注册表能答「叫什么」：`label`（导航短名）、`viewLabel`（屏内页头，缺省 =
 * `label`）、`pageHeaderTitle(view)`（唯一出口）。判据读源码而非渲染：数副标题是否重说标题是结构事实，mock 走形只会假绿。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, pageHeaderTitle } from "~/components/studio/NavItems";

const ROOT = process.cwd();

/**
 * 收口过程中**退役掉的屏名**（「一屏两名」里被删掉的那一个）。判据锚的是「`<h1>` 里出现一个屏名」；
 * 若 `known` 只装当前名字，把「队列与运行」改成「队列」那次提交会同时抹掉守卫的计数能力 —— 形状还在，
 * 判据却看不见、无人变红。退役名清单让「改回去」继续被拦。
 */
/* SAFETY: 类型断言已复核 */
const RETIRED_SCREEN_NAMES = [
  /* 队列与运行 → 队列（ISSUE #1423：与侧栏 / 页签同一个名字）。 */
  "队列与运行",
  /* 历史记录 → 历史（同上，多出来的「记录」两个字没多给信息）。 */
  "历史记录",
] as const;

/**
 * 用 `ui/page-header` 的屏（它的调用面）。它缺席说明收口被绕开了。⚠️ **这是具名清单，不是「所有屏」**：
 * 拦得住「这些屏退回手抄」，拦不住第 8 个新屏自己拼页头 —— 那一半由 P86 按**形态**守
 * （`scripts/check-ui-primitives.cjs`，规范 16 §16.2.4.73）：锚 `.u-title-page` 与 `mt-1 text-sm` 同现。
 */
/* SAFETY: 类型断言已复核 */
const PAGE_HEADER_CONSUMERS = [
  "src/components/console/ConsoleView.tsx",
  /* 路由壳 `app/(main)/models/page.tsx` 只留 `metadata` + 挂载 —— 页头在
   * 实现侧（`pageHeaderTitle` 是 client 侧的函数，server 壳调不到它）。
   * 浏览版退役后，壳上挂的就是这一份（`studio/ModelLibrary`）。 */
  "src/components/studio/ModelLibrary.tsx",
  "src/components/studio/ProjectOutputs.tsx",
  "src/components/studio/WorksGallery.tsx",
  "src/components/studio/history/HistoryList.tsx",
  "src/components/studio/library/ResourceLibrary.tsx",
  "src/components/studio/queue/QueueMonitorView.tsx",
  /* 「模型适配」「模式契约」两屏（ISSUE #1751）：此前它们自绘页头，
   * 而且用的是 **`h3` + `.u-title`(14px) + `text-xs`(12px)** 三处都低一档 ——
   * 连 `.u-title-page` 都没有，所以 P86 与 P83 都看不见它们。迁到
   * `ui/page-header` 之后，屏名走 `pageHeaderTitle(...)`、档位由基元给。 */
  "src/components/workshop/ModelAdaptersView.tsx",
  "src/components/workshop/mode-contract/dialog/ModeContractEditorView.tsx",
] as const;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("屏名只有一个出处（ISSUE #1423）", () => {
  it(`清单上的 ${PAGE_HEADER_CONSUMERS.length} 屏页头都走同一个基元（收口没被绕开）`, () => {
    const offenders = PAGE_HEADER_CONSUMERS.filter(
      (rel) => !read(rel).includes('from "~/components/ui/page-header"'),
    );
    expect(
      offenders,
      "这几屏没走 `ui/page-header` —— 页头的类名一旦各拼一遍，" +
        "「标题该写哪个名字」就又没有唯一出处了",
    ).toEqual([]);
  });

  it("`viewLabel` 不许只是 `label` 的同义扩写（`· X` / `-X` / 「与X」那一族）", () => {
    const offenders: Array<string> = [];
    for (const item of NAV_ITEMS) {
      const extra = item.viewLabel;
      if (extra === undefined) {
        continue;
      }
      /* 判据：把全名剥掉短名与分隔符之后还剩多少实质内容。
         剩下 0 字 = 纯粹的第二套说法（「队列」vs「队列与运行」的「与运行」是
         4 个字，不是 0 —— 所以下面还要单独判「短名是全名的前缀」这一族）。 */
      const stripped = extra.replace(item.label, "").replaceAll(/[·・\-—\s]/g, "");
      if (stripped.length > 0 && extra.startsWith(item.label)) {
        offenders.push(`${item.id}: label「${item.label}」/ viewLabel「${extra}」`);
      }
    }
    expect(
      offenders,
      "这两个名字指的是同一件事，只是长了点 —— 那是标题区吃空间的头号来源。" +
        "要么把 `viewLabel` 删掉（缺省 = label），要么真的换个能多给信息的名字",
    ).toEqual([]);
  });

  it("页头标题的出口对每一项都给得出非空字符串", () => {
    for (const item of NAV_ITEMS) {
      const title = pageHeaderTitle(item.id);
      expect(title.length, `${item.id} 取不到页头标题`).toBeGreaterThan(0);
    }
  });

  /**
   * 判据锚**形态**：`h1` 子节点直接是一段中文字面量，且与某个导航项的 `label` / `viewLabel` 同字。
   * 命中说明这一屏绕过注册表自己写了一遍屏名，而「自己有第二份」正是漂移的起点。抽成具名函数是为了
   * 给它**正例**：`0` 只有在「数得出来」时才可信（P82 粗锚漏计 79 处，规范 16 §16.2.4.72 末段）。
   */
  function bareScreenNameHeadings(text: string): Array<string> {
    const known = new Set([
      /* 注册表里**当前**的每一个屏名。 */
      ...NAV_ITEMS.flatMap((item) => [item.label, item.viewLabel ?? item.label]),
      /* 加已退役的那几个：判据只认当前名字的话，它会在**收口那一刻**同时失去
       * 计数能力 —— 正是这条守卫要拦的形状从「命中」变成「看不见」，
       * 而它自己不会红（实测：本文件第一版正是这么漏掉「队列与运行」的）。
       * 一份只认得新名字的守卫，等价于没有守卫。 */
      ...RETIRED_SCREEN_NAMES,
    ]);
    const hits: Array<string> = [];
    for (const match of text.matchAll(/<h[12]\b[^>]*>\s*([^\s<>{][^<>{]*?)\s*<\/h[12]>/g)) {
      const content = match[1]?.trim() ?? "";
      if (known.has(content)) {
        hits.push(content);
      }
    }
    return hits;
  }

  it("判据数得出来（正例：喂进收口前的真实形状，断言被数到）", () => {
    /* 这两段就是收口前的原文 —— 「队列与运行」是 `QueueMonitorView.tsx` 的 h1，
     * 「历史记录」是 `HistoryList.tsx` 的 h1。喂进来必须被数到，否则下面那条
     * 断言 `[]` 只是「判据在空转」。 */
    expect(
      bareScreenNameHeadings('<h1 className="font-title u-title-page">队列与运行</h1>'),
    ).toEqual(["队列与运行"]);
    expect(bareScreenNameHeadings('<h1 className="x">历史记录</h1>')).toEqual(["历史记录"]);
    /* 反面：收口后的写法不误报（`<h1>` 由基元渲染，视图里没有它）。 */
    expect(bareScreenNameHeadings('<PageHeader title={pageHeaderTitle("queue")} />')).toEqual([]);
  });

  it("屏内 `h1` 不许再出现裸字面量的屏名（`<h1>队列与运行</h1>` 那种）", () => {
    const offenders = PAGE_HEADER_CONSUMERS.flatMap((rel) =>
      bareScreenNameHeadings(read(rel)).map((name) => `${rel}: <h1>${name}</h1>`),
    );
    expect(
      offenders,
      "屏名写在视图文件里了 —— 改走 `pageHeaderTitle(view)`，" +
        "名字就只有 `NavItems.tsx` 一处能改",
    ).toEqual([]);
  });

  it("标题里不许连写两个屏名（「项目名 · 视频成片工作室」那一族）", () => {
    /* 形态：`<h1>` 的属性段之后，紧跟「项目名 + 分隔点 + 另一段中文」。
       判据收窄到 `h1` 的**同一行**内出现 `·` 或 `・` —— 标题右侧挂副名正是
       FilmStudioTopBar 收口前那个形状。 */
    const hits: Array<string> = [];
    for (const rel of [
      "src/components/studio/FilmStudioTopBar.tsx",
      "src/components/studio/ProjectOutputs.tsx",
      ...PAGE_HEADER_CONSUMERS,
    ]) {
      const text = read(rel);
      for (const line of text.split("\n")) {
        if (!/<h1\b/.test(line)) {
          continue;
        }
        if (/[·・]/.test(line)) {
          hits.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(hits, "页头标题里又挂了一个屏名 —— 那是同一件事的第二个名字（ISSUE #1423）").toEqual([]);
  });
});
