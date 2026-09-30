// @vitest-environment jsdom
/**
 * 回归护栏：启动页的日志面板**不再把用户拽回底部**。
 *
 * 现场（用户反馈）：点开「查看日志」往上翻看早期编排输出，每 1.5 秒一次的
 * 轮询刷新就把他拽回最新一行——`renderLog` 当时无条件
 * `logPanel.scrollTop = logPanel.scrollHeight`，**没有「用户有没有接管滚动」
 * 这个判据**。启动页是编译期内嵌的独立页面（`src-tauri/splash-assets/**`，
 * 源在 `public/splash.html`），既不在 `src/**` 的 P21 硬闸扫描面里，也没有
 * 任何用例跑过它的脚本，所以这条一直没被判据拦下。
 *
 * 本组用例**真跑那一段页面脚本**（把内联 `<script>` 交给 jsdom 求值，不是拿
 * 正则去凑源码形态）：贴底几何是量出来的，不是读出来的。判据四条：
 *   ① 贴着底时刷新照旧贴底（新日志跟着滚）；
 *   ② 用户上翻后刷新**一个像素都不动**他的位置；
 *   ③ 暂停必须有可见出口（「回到最新」按钮出现），点了回到最新并恢复跟随；
 *   ④ 阈值内（32px）不该因为抖一下就掉出跟随态。
 *
 * 反向验证：把 `renderLog` 改回无条件贴底 → ② 立刻失败。
 *
 * 环境用 vitest 的 jsdom（**不直接 import `jsdom`**：它没有类型声明，为一条
 * 用例引入 `@types/jsdom` 是给所有人加一笔依赖）；页面 DOM 与脚本都从真实的
 * 内嵌产物里取，被测的还是那一份字节。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** 用例读**内嵌进壳的那一份**（`index.html` 是窗口会加载的兜底名，与
 * `splash.html` 内容一致），而不是 `public/` 的源——加载的是它，就测它。 */
const PAGE_REL = "src-tauri/splash-assets/index.html";

const PAGE_HTML = fs.readFileSync(path.join(ROOT, PAGE_REL), "utf8");

/** 从页面里取出内联 `<script>` 的正文（页面只有这一段）。 */
function pageScript(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error(`${PAGE_REL} 里找不到内联 <script>`);
  return match[1];
}

/** 量得到的滚动几何（jsdom 不做布局，两个高度都得自己给）。 */
const SCROLL_HEIGHT = 2000;
const CLIENT_HEIGHT = 300;

/** 页面脚本在 jsdom 里暴露出来的那几件事（本组用例的读法，不是实现）。 */
interface SplashInternals {
  renderLog: (text: string) => void;
}

/**
 * 把启动页装载进**当前** jsdom 文档并跑它的脚本。
 *
 * 定时器全部停掉：本组用例只关心「刷新一帧」这一个动作，让页面自己按
 * 250ms / 1.5s 转起来只会引入不确定性。壳 IPC 一律不可用（页面据此走兜底
 * 分支）——日志正文由用例自己喂进去，测的是渲染那一侧。
 */
function bootSplash(): {
  scroll: HTMLElement;
  setScrollTop: (value: number) => void;
  renderLog: (text: string) => void;
  latestVisible: () => boolean;
  openPanel: () => void;
} {
  document.documentElement.innerHTML = PAGE_HTML;

  window.setInterval = (() => 0) as unknown as typeof window.setInterval;
  window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
  /* 页面自己的 warn 与本组用例无关（壳 IPC 与网络都不可用时各喊一嗓子），
   * 静音掉——真红应当来自断言，而不是一屏噪声。 */
  window.console.warn = (): void => {
    /* 故意清空：只为吞掉页面的噪声 warn。 */
  };
  /* 页面每轮 tick 会探 /api/health（自己那个常驻轮询）。jsdom 里的 fetch 会
   * 真的往外发请求，测试机上恒 ECONNREFUSED 并被 vitest 记成未捕获错误——
   * 那不是本组用例的红，却会把「6 errors」挂在结果上。一律拒掉。 */
  window.fetch = () => Promise.reject(new Error("网络在用例里不可用"));

  const internals = window.eval(
    `${pageScript(PAGE_HTML)}\n;({ renderLog })`,
  ) as SplashInternals;

  const scroll = document.getElementById("log-scroll")!;
  Object.defineProperty(scroll, "scrollHeight", {
    configurable: true,
    get: () => SCROLL_HEIGHT,
  });
  Object.defineProperty(scroll, "clientHeight", {
    configurable: true,
    get: () => CLIENT_HEIGHT,
  });

  return {
    scroll,
    /** 模拟浏览器：赋值后自己发一条 scroll 事件（真实浏览器就是这么通知的）。 */
    setScrollTop: (value: number) => {
      scroll.scrollTop = value;
      scroll.dispatchEvent(new window.Event("scroll"));
    },
    renderLog: internals.renderLog.bind(window),
    /** 「回到最新」按钮当前可不可见（页面用 data-visible 表达）。 */
    latestVisible: () =>
      document.getElementById("log-latest")!.dataset.visible === "true",
    /** 走真实入口展开日志面板（用户看到的那一下点击）。面板收起时
     * 「回到最新」不该出现——它只对看得见面板的用户有意义。 */
    openPanel: () => {
      document
        .getElementById("log-btn")!
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    },
  };
}

describe("启动页日志面板：用户上翻后刷新不再把他拽回底部", () => {
  it("贴着底时刷新照旧贴底（新日志跟着滚）", () => {
    const env = bootSplash();
    env.openPanel();
    env.renderLog("[a] 第一批");
    expect(env.scroll.scrollTop, "首帧应落到最新").toBe(SCROLL_HEIGHT);
    env.renderLog("[b] 第二批");
    expect(env.scroll.scrollTop, "仍贴底时继续跟随").toBe(SCROLL_HEIGHT);
  });

  it("用户往上翻之后，刷新**一个像素都不动**他的位置", () => {
    const env = bootSplash();
    env.openPanel();
    env.renderLog("[a] 第一批");
    /* 上翻到距底 800px（远大于 32px 阈值）→ 退出跟随。 */
    const parked = SCROLL_HEIGHT - CLIENT_HEIGHT - 800;
    env.setScrollTop(parked);

    env.renderLog("[b] 第二批（刷新时新到的内容）");
    expect(env.scroll.scrollTop, "用户已接管滚动，刷新不该覆盖他的位置").toBe(
      parked,
    );
  });

  it("暂停有可见出口：按钮出现，点了回到最新并恢复跟随", () => {
    const env = bootSplash();
    env.openPanel();
    env.renderLog("第一帧");
    expect(env.latestVisible(), "还在跟随时不该出现按钮").toBe(false);

    env.setScrollTop(100);
    expect(env.latestVisible(), "上翻后必须给出可见出口").toBe(true);

    /* 点按钮：立刻回到底部，并且此后刷新继续跟随。 */
    document
      .getElementById("log-latest")!
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(env.scroll.scrollTop, "点「回到最新」要真的到底").toBe(
      SCROLL_HEIGHT,
    );
    expect(env.latestVisible(), "恢复跟随后按钮收回").toBe(false);

    env.renderLog("新的一帧");
    expect(env.scroll.scrollTop, "恢复跟随后刷新照旧贴底").toBe(SCROLL_HEIGHT);
  });

  it("用户自己滚回底部即恢复跟随（不必点按钮）", () => {
    const env = bootSplash();
    env.openPanel();
    env.renderLog("第一帧");
    env.setScrollTop(100);
    expect(env.latestVisible()).toBe(true);

    env.setScrollTop(SCROLL_HEIGHT - CLIENT_HEIGHT);
    expect(env.latestVisible(), "滚回底部即恢复跟随").toBe(false);
    env.renderLog("新的一帧");
    expect(env.scroll.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("上滚一点点仍在跟随（32px 阈值内不掉出跟随态）", () => {
    const env = bootSplash();
    env.openPanel();
    env.renderLog("第一帧");
    /* 距底 31px：仍算「贴着底」，不要因为抖一下就暂停跟随。 */
    env.setScrollTop(SCROLL_HEIGHT - CLIENT_HEIGHT - 31);
    expect(env.latestVisible(), "阈值内不该退出跟随").toBe(false);
    env.renderLog("新的一帧");
    expect(env.scroll.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("刷新时内容没变就完全不碰滚动位置（页面自己的去重仍在）", () => {
    const env = bootSplash();
    env.openPanel();
    env.renderLog("[a] 同一份内容");
    expect(env.scroll.scrollTop).toBe(SCROLL_HEIGHT);
    env.setScrollTop(120);
    env.renderLog("[a] 同一份内容");
    expect(env.scroll.scrollTop, "同一份内容不该引发任何滚动").toBe(120);
  });
});
