// @vitest-environment jsdom
/**
 * 回归护栏：启动页日志面板**不再把用户拽回底部**（现场：1.5s 一次的轮询刷新把正在上翻的用户拽回最新一行，`renderLog` 无条件
 * 贴底、缺「用户是否接管滚动」判据）。该页是编译期内嵌的独立页面（源 `public/splash.html`），不在 `src/**` 硬闸扫描面、也无用例跑其脚本；
 * 本组把内联 `<script>` 交给 jsdom 真跑（不直接 import `jsdom`：无类型声明）：贴底照旧跟滚、上翻后一像素不动、暂停须有「回到最新」出口、32px 内不掉跟随。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";

const ROOT = process.cwd();
/** 用例读**内嵌进壳的那一份**（`index.html` 是窗口会加载的兜底名，与
 * `splash.html` 内容一致），而不是 `public/` 的源——加载的是它，就测它。 */
const PAGE_REL = "src-tauri/splash-assets/index.html";

const PAGE_HTML = fs.readFileSync(path.join(ROOT, PAGE_REL), "utf8");

/** 从页面里取出内联 `<script>` 的正文（页面只有这一段）。 */
function pageScript(html: string): string {
  const match = /<script>(?<body>[\s\S]*?)<\/script>/i.exec(html);
  const body = match?.groups?.body ?? "";
  if (body === "") {
    throw new Error(`${PAGE_REL} 里找不到内联 <script>`);
  }
  return body;
}

/** 量得到的滚动几何（jsdom 不做布局，两个高度都得自己给）。 */
const SCROLL_HEIGHT = 2000;
const CLIENT_HEIGHT = 300;

/** 页面脚本在 jsdom 里暴露出来的那几件事（本组用例的读法，不是实现）。 */
type SplashInternals = {
  renderLog: (text: string) => void;
};

/** 形状守卫替代断言收型（B5 清账）：页面交出的必须是可调用的 renderLog。 */
function isSplashInternals(value: unknown): value is SplashInternals {
  return isRecord(value) && typeof value.renderLog === "function";
}

/**
 * 把启动页装载进**当前** jsdom 文档并跑它的脚本。
 * 定时器全部停掉：只关心「刷新一帧」这一动作，让页面按 250ms / 1.5s 自己转起来只会引入不确定性。
 * 壳 IPC 一律不可用（页面据此走兜底分支）—— 日志正文由用例喂入，测的是渲染那一侧。
 */
function bootSplash(): {
  latestVisible: () => boolean;
  openPanel: () => void;
  renderLog: (text: string) => void;
  scroll: HTMLElement;
  setScrollTop: (value: number) => void;
} {
  document.documentElement.innerHTML = PAGE_HTML;

  /* 定时器桩走 defineProperty：descriptor.value 不参与类型检查，
     「() => 0 不满足 Node 侧重载返回 Timeout」的形状争议就不再需要断言（B5 清账）。 */
  Object.defineProperty(window, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(window, "setTimeout", { configurable: true, value: () => 0 });
  /* 页面自己的 warn 与本组用例无关（壳 IPC 与网络都不可用时各喊一嗓子），
   * 静音掉——真红应当来自断言，而不是一屏噪声。 */
  window.console.warn = (): void => {
    /* 故意清空：只为吞掉页面的噪声 warn。 */
  };
  /* 页面每轮 tick 会探 /api/health（自己那个常驻轮询）。jsdom 里的 fetch 会
   * 真的往外发请求，测试机上恒 ECONNREFUSED 并被 vitest 记成未捕获错误——
   * 那不是本组用例的红，却会把「6 errors」挂在结果上。一律拒掉。 */
  window.fetch = () => Promise.reject(new Error("网络在用例里不可用"));

  /* eval 的返回是 any → 先落 unknown，再走形状守卫收窄（B5 清账）。
     守卫不过说明内联脚本被改得交不出 renderLog —— 这本身就是该红的漂移。 */
  const evaluated: unknown = window.eval(`${pageScript(PAGE_HTML)}\n;({ renderLog })`);
  if (!isSplashInternals(evaluated)) {
    throw new Error("启动页脚本没有交出可调用的 renderLog —— 内联脚本被改了？");
  }
  const internals = evaluated;

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
    latestVisible: () => document.getElementById("log-latest")!.dataset.visible === "true",
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
    expect(env.scroll.scrollTop, "用户已接管滚动，刷新不该覆盖他的位置").toBe(parked);
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
    expect(env.scroll.scrollTop, "点「回到最新」要真的到底").toBe(SCROLL_HEIGHT);
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
