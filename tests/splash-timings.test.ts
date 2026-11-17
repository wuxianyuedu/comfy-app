// @vitest-environment jsdom
/**
 * 启动页耗时条（ISSUE #4185）的判据：timings 到达时画出逐段条与文字行、
 * 空读数隐藏整块、壳侧兜底轮次（不带 timings 字段）不顶掉已有画面、
 * 进行中段（endMs null）在悬停提示里标「进行中」。
 * 页面是编译期内嵌的独立页面（源 `public/splash.html`），本组把内联脚本
 * 交给 jsdom 真跑，读的是**内嵌进壳的那一份**（与 splash-log-scroll-follow 同一装载方式）。
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

type SplashTimings = {
  renderTimings: (timings: unknown) => void;
  /** 与页面实现同形：第 6 参是 timings（可选）。rest 元组避开 max-params 判据。 */
  updateUI: (
    ...args: [
      progress: number,
      phase: string,
      message: string,
      error: boolean,
      elapsed: number,
      timings?: unknown,
    ]
  ) => void;
};

function isSplashTimings(value: unknown): value is SplashTimings {
  return (
    isRecord(value) &&
    typeof value.updateUI === "function" &&
    typeof value.renderTimings === "function"
  );
}

/** HTMLCollection 取出的 Element 收窄成 HTMLElement（带判据，不用 `as`；
 *  索引访问在 noUncheckedIndexedAccess 下可能 undefined，一并收进来）。 */
function htmlEl(value: Element | undefined | null): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new TypeError("启动页 DOM 节点不是 HTMLElement");
  }
  return value;
}

/** 装载启动页并交出 updateUI / renderTimings（定时器与网络全部桩掉）。 */
function bootSplash(): SplashTimings {
  document.documentElement.innerHTML = PAGE_HTML;
  Object.defineProperty(window, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(window, "setTimeout", { configurable: true, value: () => 0 });
  /* 页面自己的 warn 与本组用例无关（壳 IPC 与网络都不可用时各喊一嗓子），
   * 静音掉——真红应当来自断言，而不是一屏噪声。 */
  window.console.warn = (): void => {
    /* 故意清空：只为吞掉页面的噪声 warn（与 splash-log-scroll-follow 同一口径）。 */
  };
  window.fetch = () => Promise.reject(new Error("网络在用例里不可用"));
  const evaluated: unknown = window.eval(
    `${pageScript(PAGE_HTML)}\n;({ updateUI, renderTimings })`,
  );
  if (!isSplashTimings(evaluated)) {
    throw new Error("启动页脚本没有交出 updateUI / renderTimings —— 内联脚本被改了？");
  }
  return evaluated;
}

const TIMINGS = [
  { key: "env-toolchain", label: "环境与工具链", startMs: 0, endMs: 300, durationMs: 300 },
  { key: "deps-sync", label: "依赖对齐", startMs: 300, endMs: 3100, durationMs: 2800 },
  { key: "port-resolve", label: "端口解析", startMs: 3100, endMs: 3105, durationMs: 5 },
  { key: "ready-wait", label: "等待就绪", startMs: 3105, endMs: null, durationMs: 9000 },
];

describe("启动页耗时条（ISSUE #4185）", () => {
  it("带 timings 的快照：画出逐段条 + 文字行（含合计；<0.1s 的段不进文字行）", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    const strip = document.getElementById("timing-strip")!;
    const text = document.getElementById("timing-text")!;
    expect(document.getElementById("timings")!.style.display).toBe("block");
    // 条形全量保留（含近零段，2px 细条兜底）。
    expect(strip.children).toHaveLength(TIMINGS.length);
    const widths = [...strip.children].map((seg) => htmlEl(seg).style.width);
    // 各段宽度按 durationMs 占比（进行中段 9000/12105 ≈ 74.4%）。
    const pct = (i: number) => Number.parseFloat(widths[i] ?? "0");
    expect(pct(2), "近零段最窄").toBeLessThan(pct(0));
    expect(pct(0)).toBeLessThan(pct(1));
    expect(pct(1)).toBeLessThan(pct(3));
    // 文字行只列 ≥0.1s 的段：紧凑窗口一行放不下全部段名，让位给真花时间的段。
    expect(text.textContent).toContain("环境与工具链 0.3s");
    expect(text.textContent).toContain("依赖对齐 2.8s");
    expect(text.textContent).toContain("等待就绪 9.0s");
    expect(text.textContent).toContain("合计 12.1s");
    expect(text.textContent).not.toContain("端口解析");
  });

  it("进行中段（endMs null）在悬停提示里标「进行中」", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    const strip = document.getElementById("timing-strip")!;
    const last = htmlEl(strip.children[3]);
    expect(last.title).toContain("等待就绪");
    expect(last.title).toContain("进行中");
    expect(htmlEl(strip.children[0]).title).not.toContain("进行中");
  });

  it("空数组（还没记到任何段）：整块隐藏", () => {
    const splash = bootSplash();
    splash.updateUI(0.1, "port-check", "检查端口", false, 1, []);
    expect(document.getElementById("timings")!.style.display).toBe("none");
    expect(document.getElementById("timing-strip")!.children).toHaveLength(0);
  });

  it("不带 timings 字段的轮次（壳侧兜底快照）：保留上一次画面，不闪空块", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    expect(document.getElementById("timings")!.style.display).toBe("block");
    // 壳的 fallback 快照没有 timings 字段 → updateUI 收到 undefined → 不重画。
    splash.updateUI(0.4, "shell-orchestrating", "拉起本地服务", false, 13);
    expect(document.getElementById("timings")!.style.display).toBe("block");
    expect(document.getElementById("timing-strip")!.children).toHaveLength(TIMINGS.length);
    expect(document.getElementById("timing-text")!.textContent).toContain("合计 12.1s");
  });
});
