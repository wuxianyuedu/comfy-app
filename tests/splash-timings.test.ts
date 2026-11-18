// @vitest-environment jsdom
/**
 * 启动页耗时分解（ISSUE #4185 立项 / #4327 改逐行可读）的判据：timings 到达时
 * 画出逐行「阶段名 + 比例条 + 秒数 · 占比」（按耗时降序点名 ≥0.1s 的前 3 行，
 * 其余段收进末行「其余 N 段共 X s · 合计 Y s」）、空读数隐藏整块、壳侧兜底
 * 轮次（不带 timings 字段）不顶掉已有画面、进行中段（endMs null）行尾标
 * 「（进行中）」。#4327：12 色密彩条（颜色不承载语义、段又密得认不出谁是谁）
 * 已退役，判据随行为同批改写；条宽按「该段 / 最长段」画，占比与合计的口径同
 * 应用内日志面板的「启动耗时分解」卡（合计取墙钟，并行段不求和）。
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

const TIMINGS = [
  { key: "env-toolchain", label: "环境与工具链", startMs: 0, endMs: 300, durationMs: 300 },
  { key: "deps-sync", label: "依赖对齐", startMs: 300, endMs: 3100, durationMs: 2800 },
  { key: "port-resolve", label: "端口解析", startMs: 3100, endMs: 3105, durationMs: 5 },
  { key: "ready-wait", label: "等待就绪", startMs: 3105, endMs: null, durationMs: 9000 },
];

/** 逐行读数：行文本（label + 值）与条宽，按渲染顺序返回。 */
function readRows(): Array<{ fillWidth: string; label: string; text: string }> {
  return [...document.querySelectorAll("#timing-rows .timing-row")].map((row) => {
    const labelEl = row.querySelector(".timing-label");
    const fillEl = row.querySelector(".timing-fill");
    return {
      text: row.textContent ?? "",
      label: labelEl?.textContent ?? "",
      fillWidth: fillEl instanceof HTMLElement ? fillEl.style.width : "",
    };
  });
}

describe("启动页耗时分解改逐行可读（ISSUE #4185 立项 / #4327 改判据）", () => {
  it("带 timings 的快照：按耗时降序点名 ≥0.1s 的前 3 行，其余段收进末行", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    expect(document.getElementById("timings")!.style.display).toBe("block");
    const rows = readRows();
    expect(rows, "3 行点名 + 1 行其余段").toHaveLength(4);
    expect(rows.map((r) => r.label)).toEqual([
      "等待就绪",
      "依赖对齐",
      "环境与工具链",
      "", // 末行是收拢行，没有阶段名
    ]);
    // 值列：秒数 · 占比（占比一位小数；墙钟合计 12105ms，并行段不求和）
    expect(rows[0]?.text).toBe("等待就绪9.0s · 74.3%（进行中）");
    expect(rows[1]?.text).toBe("依赖对齐2.8s · 23.1%");
    expect(rows[2]?.text).toBe("环境与工具链0.3s · 2.5%");
    expect(rows[3]?.text).toBe("其余 1 段共 0.0s · 合计 12.1s");
    // 条宽按「该段 / 最长段」画：最长段占满轨道（jsdom 的 cssstyle 会把
    // "100.00%" 规范化成 "100%"，按数值比较）。
    expect(Number.parseFloat(rows[0]?.fillWidth ?? "")).toBeCloseTo(100);
    expect(Number.parseFloat(rows[1]?.fillWidth ?? "")).toBeCloseTo(31.11);
    expect(Number.parseFloat(rows[2]?.fillWidth ?? "")).toBeCloseTo(3.33);
  });

  it("进行中段（endMs null）行尾标「（进行中）」，已完成的段不带", () => {
    const splash = bootSplash();
    splash.updateUI(0.3, "dev-server-starting", "启动中", false, 12, TIMINGS);
    const rows = readRows();
    expect(rows[0]?.text).toContain("进行中");
    for (const row of rows.slice(1)) {
      expect(row.text).not.toContain("进行中");
    }
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

  it("段数不超过 3 且都 ≥0.1s → 全部点名，末行只有合计（不出「其余」）", () => {
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
