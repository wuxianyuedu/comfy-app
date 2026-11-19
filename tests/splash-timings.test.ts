// @vitest-environment jsdom
/**
 * 启动页耗时时间线（ISSUE #4185 立项 / #4327 改逐行可读 / #4504 改全量时间线）
 * 的判据：timings 到达时按**开始顺序**把全部阶段逐行铺开（行首状态 ✓ / 进行中
 * 转圈，行尾「秒数 · 占比」，进行中段加「（进行中）」），条改甘特式——左缘按
 * 该段起点占合计的比例、宽度按该段时长占合计的比例，先后顺序与并行段在轨道上
 * 直接可读；不再按耗时降序只点名前 3 行（那会让启动中最长的「等待就绪 / 首页
 * 编译」被最早的两段预检挤出画面）。已完成且不足 0.1s 的微小段仍收进末行
 * 「其余 N 段共 X s · 合计 Y s」，进行中段永不收拢；空读数隐藏整块；壳侧兜底
 * 轮次（不带 timings 字段）不顶掉已有画面。合计取墙钟（最后一刻 − 最早一刻），
 * 并行段不求和，与「启动耗时分解」应用内卡同一口径。
 * 页面是编译期内嵌的独立页面（源 `public/splash.html`），本组把内联脚本交给
 * jsdom 真跑，读的是**内嵌进壳的那一份**（与 splash-log-scroll-follow 同一装载方式）。
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

/** 典型启动中段：两段已完成的预检 + 一段 5ms 的微小段（应被收拢）+ 进行中的等待。 */
const TIMINGS = [
  { key: "env-toolchain", label: "环境与工具链", startMs: 0, endMs: 300, durationMs: 300 },
  { key: "deps-sync", label: "依赖对齐", startMs: 300, endMs: 3100, durationMs: 2800 },
  { key: "port-resolve", label: "端口解析", startMs: 3100, endMs: 3105, durationMs: 5 },
  { key: "ready-wait", label: "等待就绪", startMs: 3105, endMs: null, durationMs: 9000 },
];

/** 逐行读数：状态、行文本（label + 值）与甘特条位置，按渲染顺序返回。 */
function readRows(): Array<{
  fillLeft: string;
  fillWidth: string;
  label: string;
  state: string;
  text: string;
}> {
  return [...document.querySelectorAll("#timing-rows .timing-row")].map((row) => {
    const labelEl = row.querySelector(".timing-label");
    const fillEl = row.querySelector(".timing-fill");
    const stateEl = row.querySelector(".timing-state");
    return {
      text: row.textContent ?? "",
      label: labelEl?.textContent ?? "",
      state: stateEl?.textContent ?? "",
      fillLeft: fillEl instanceof HTMLElement ? fillEl.style.marginLeft : "",
      fillWidth: fillEl instanceof HTMLElement ? fillEl.style.width : "",
    };
  });
}

describe("启动页耗时时间线（ISSUE #4185 立项 / #4327 改逐行 / #4504 改全量时间线）", () => {
  it("按开始顺序全量铺开：不再按耗时降序点名前 3 行，微小完成段收进末行", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    expect(document.getElementById("timings")!.style.display).toBe("block");
    const rows = readRows();
    // 时间线序：环境与工具链(0ms) → 依赖对齐(300ms) → 等待就绪(3105ms，进行中)；
    // 端口解析 5ms 是已完成的微小段 → 收进末行，不占一行。
    expect(rows.map((r) => r.label)).toEqual([
      "环境与工具链",
      "依赖对齐",
      "等待就绪",
      "", // 末行是收拢行，没有阶段名
    ]);
    // 值列：秒数 · 占比（占比一位小数；墙钟合计 12_105ms，并行段不求和）。
    // textContent 含行首状态符：已完成行以 ✓ 开头。
    expect(rows[0]?.text).toBe("✓环境与工具链0.3s · 2.5%");
    expect(rows[1]?.text).toBe("✓依赖对齐2.8s · 23.1%");
    expect(rows[2]?.text).toBe("等待就绪9.0s · 74.3%（进行中）");
    expect(rows[3]?.text).toBe("其余 1 段共 0.0s · 合计 12.1s");
  });

  it("甘特条：左缘 = 起点占合计，宽 = 时长占合计（先后与并行在轨道上可读）", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    const rows = readRows();
    const pct = (v: string): number => Number.parseFloat(v);
    // 合计 12_105ms：环境与工具链从 0 起 300ms；依赖对齐从 300ms 起 2800ms；
    // 等待就绪从 3105ms 起 9000ms（进行中，按当下计）。
    expect(pct(rows[0]?.fillLeft ?? "")).toBeCloseTo(0);
    expect(pct(rows[0]?.fillWidth ?? "")).toBeCloseTo((300 / 12_105) * 100, 1);
    expect(pct(rows[1]?.fillLeft ?? "")).toBeCloseTo((300 / 12_105) * 100, 1);
    expect(pct(rows[1]?.fillWidth ?? "")).toBeCloseTo((2800 / 12_105) * 100, 1);
    expect(pct(rows[2]?.fillLeft ?? "")).toBeCloseTo((3105 / 12_105) * 100, 1);
    expect(pct(rows[2]?.fillWidth ?? "")).toBeCloseTo((9000 / 12_105) * 100, 1);
  });

  it("行首状态：已完成 ✓，进行中是转圈（spinner），「（进行中）」只标在 running 行", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    const rows = readRows();
    expect(rows[0]?.state).toBe("✓");
    expect(rows[1]?.state).toBe("✓");
    expect(rows[2]?.state).toBe(""); // spinner 是子元素，textContent 为空
    expect(document.querySelectorAll("#timing-rows .timing-state .spinner")).toHaveLength(1);
    expect(rows[2]?.text).toContain("进行中");
    for (const row of rows.slice(0, 2)) {
      expect(row.text).not.toContain("进行中");
    }
  });

  it("并行段（后台建表 vs 等待就绪）各自成行，甘特左缘不同", () => {
    const splash = bootSplash();
    splash.renderTimings([
      { key: "dev-spawn", label: "服务拉起", startMs: 100, endMs: 600, durationMs: 500 },
      { key: "schema-sync", label: "后台建表", startMs: 600, endMs: 30_000, durationMs: 29_400 },
      { key: "ready-wait", label: "等待服务就绪", startMs: 600, endMs: null, durationMs: 45_000 },
    ]);
    const rows = readRows();
    expect(rows.map((r) => r.label)).toEqual(["服务拉起", "后台建表", "等待服务就绪", ""]);
    // 后台建表与等待服务就绪同刻起跑（并行）：左缘相同、宽度不同。
    expect(rows[1]?.fillLeft).toBe(rows[2]?.fillLeft);
    expect(rows[1]?.fillWidth).not.toBe(rows[2]?.fillWidth);
    // 墙钟合计 = 最后时刻(45600) − 最早起点(100) = 45.5s（并行段不求和）。
    expect(rows[3]?.text).toBe("合计 45.5s");
  });

  it("进行中的段不足 0.1s 也不收拢（正在发生的事不允许被折进「其余」）", () => {
    const splash = bootSplash();
    splash.renderTimings([
      { key: "env-toolchain", label: "环境与工具链", startMs: 0, endMs: 300, durationMs: 300 },
      { key: "first-page", label: "首页编译", startMs: 300, endMs: null, durationMs: 40 },
    ]);
    const rows = readRows();
    expect(rows.map((r) => r.label)).toEqual(["环境与工具链", "首页编译", ""]);
    expect(rows[1]?.text).toContain("（进行中）");
  });

  it("空数组（还没记到任何段）：整块隐藏", () => {
    const splash = bootSplash();
    splash.updateUI(0.1, "port-check", "检查端口", false, 1, []);
    expect(document.getElementById("timings")!.style.display).toBe("none");
    expect(document.getElementById("timing-rows")!.childElementCount).toBe(0);
  });

  it("不带 timings 字段的轮次（壳侧兜底快照）：保留上一次画面，不闪空块", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    expect(document.getElementById("timings")!.style.display).toBe("block");
    // 壳的 fallback 快照没有 timings 字段 → updateUI 收到 undefined → 不重画。
    splash.updateUI(0.4, "shell-orchestrating", "拉起本地服务", false, 13);
    expect(document.getElementById("timings")!.style.display).toBe("block");
    expect(readRows()).toHaveLength(4);
    expect(readRows()[3]?.text).toBe("其余 1 段共 0.0s · 合计 12.1s");
  });

  it("全部段不足 0.1s → 不点名任何段，只出一行合计", () => {
    const splash = bootSplash();
    splash.renderTimings([
      { key: "stale-reap", label: "回收上次残留", startMs: 0, endMs: 2, durationMs: 2 },
      { key: "port-resolve", label: "端口解析", startMs: 2, endMs: 3, durationMs: 1 },
      { key: "deps-sync", label: "依赖对齐", startMs: 3, endMs: 40, durationMs: 37 },
    ]);
    const rows = readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("合计 0.0s（3 段均不足 0.1s）");
    expect(document.querySelectorAll("#timing-rows .timing-fill")).toHaveLength(0);
  });

  it("段数少且都 ≥0.1s → 全部点名，末行只有合计（不出「其余」）", () => {
    const splash = bootSplash();
    splash.renderTimings([
      { key: "env-toolchain", label: "环境与工具链", startMs: 120, endMs: 720, durationMs: 600 },
      { key: "port-reclaim", label: "端口残留回收", startMs: 722, endMs: 1320, durationMs: 598 },
      { key: "cache", label: "编译缓存", startMs: 1330, endMs: 1830, durationMs: 500 },
    ]);
    const rows = readRows();
    expect(rows.map((r) => r.label)).toEqual(["环境与工具链", "端口残留回收", "编译缓存", ""]);
    expect(rows[3]?.text).toBe("合计 1.7s");
    expect(document.querySelectorAll("#timing-rows .timing-fill")).toHaveLength(3);
  });

  it("12 色密彩条已退役：源里不再有按序取色的调色板与分段条元素", () => {
    const script = pageScript(PAGE_HTML);
    expect(script, "按序循环取色的调色板不得回来").not.toContain("TIMING_COLORS");
    expect(PAGE_HTML, "分段细条元素不得回来").not.toContain("timing-strip");
  });
});
