// @vitest-environment jsdom
/**
 * 启动页的显示判据（ISSUE #4588）：启动页撤掉逐段耗时时间线、总进度条与百分比
 * ——「每个项目的进度条意义不大」，能看出**在启动什么**（阶段转圈 + 文案、消息、
 * 服务端动态）与**启动了多少时间**（页脚计时）即可；逐段耗时分解保留在应用内
 * 「查看日志」的启动时间线（#4522）。本组钉两件事：①被撤的元素与渲染函数**不得
 * 回潮**（源是编译期内嵌的独立页面，源 `public/splash.html`）；②留下的 updateUI
 * 仍把阶段（进行中转圈 / 完成 ✓）、消息与计时画对。页面交给 jsdom 真跑，读的
 * 是**内嵌进壳的那一份**（与 splash-log-scroll-follow 同一装载方式）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";

const ROOT = process.cwd();
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

type SplashDisplay = {
  /** 与页面实现同形：进度、阶段、消息、错误、已用秒数。rest 元组避开 max-params 判据。 */
  updateUI: (
    ...args: [progress: number, phase: string, message: string, error: boolean, elapsed: number]
  ) => void;
};

function isSplashDisplay(value: unknown): value is SplashDisplay {
  return isRecord(value) && typeof value.updateUI === "function";
}

/** 装载启动页并交出 updateUI（定时器与网络全部桩掉）。 */
function bootSplash(): SplashDisplay {
  document.documentElement.innerHTML = PAGE_HTML;
  Object.defineProperty(window, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(window, "setTimeout", { configurable: true, value: () => 0 });
  /* 页面自己的 warn 与本组用例无关（壳 IPC 与网络都不可用时各喊一嗓子），
   * 静音掉——真红应当来自断言，而不是一屏噪声。 */
  window.console.warn = (): void => {
    /* 故意清空：只为吞掉页面的噪声 warn（与 splash-log-scroll-follow 同一口径）。 */
  };
  window.fetch = () => Promise.reject(new Error("网络在用例里不可用"));
  const evaluated: unknown = window.eval(`${pageScript(PAGE_HTML)}\n;({ updateUI })`);
  if (!isSplashDisplay(evaluated)) {
    throw new Error("启动页脚本没有交出 updateUI —— 内联脚本被改了？");
  }
  return evaluated;
}

describe("启动页显示（ISSUE #4588：撤进度条，留阶段 / 消息 / 计时）", () => {
  it("逐段耗时时间线与进度条已从源里撤掉，不得回潮", () => {
    expect(PAGE_HTML, "逐段耗时时间线容器不得回来").not.toContain('id="timings"');
    expect(PAGE_HTML, "逐段耗时行容器不得回来").not.toContain('id="timing-rows"');
    expect(PAGE_HTML, "总进度条轨道不得回来").not.toContain("bar-track");
    expect(PAGE_HTML, "总进度条填充不得回来").not.toContain("bar-fill");
    expect(PAGE_HTML, "百分比读数不得回来").not.toContain('id="percent"');
    expect(pageScript(PAGE_HTML), "时间线渲染函数不得回来").not.toContain("renderTimings");
  });

  it("updateUI：进行中 = 阶段转圈，消息与计时照常上屏", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12);
    expect(document.getElementById("phase")?.textContent).toContain("启动本地服务");
    expect(document.querySelectorAll("#phase .spinner")).toHaveLength(1);
    expect(document.getElementById("message")?.textContent).toBe("启动中");
    expect(document.getElementById("elapsed")?.textContent).toBe("00:12");
  });

  it("进度到 100%：阶段画 ✓（不再有百分比读数）", () => {
    const splash = bootSplash();
    splash.updateUI(1, "dev-server-ready", "服务已就绪，正在加载应用…", false, 30);
    expect(document.getElementById("phase")?.textContent).toContain("✓");
    expect(document.getElementById("phase")?.textContent).toContain("服务已就绪");
    expect(document.getElementById("percent")).toBeNull();
  });

  it("12 色密彩条已退役：源里不再有按序取色的调色板与分段条元素", () => {
    const script = pageScript(PAGE_HTML);
    expect(script, "按序循环取色的调色板不得回来").not.toContain("TIMING_COLORS");
    expect(PAGE_HTML, "分段细条元素不得回来").not.toContain("timing-strip");
  });
});
