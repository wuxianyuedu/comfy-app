// @vitest-environment jsdom
/**
 * 启动页耗时分解**改逐行可读**（#4327）：12 色密彩条颜色不承载语义、段密得
 * 认不出谁是谁（「启动界面的彩色条太难看了，要能清晰的看出来那一部分是什么」），
 * 换成逐行「阶段名 + 比例条 + 秒数 · 占比」，与应用内日志面板的「启动耗时分解」卡
 * 同一取向。该页是编译期内嵌的独立页面（源 `public/splash.html`），不在 `src/**`
 * 硬闸扫描面、也无用例直接 import 其脚本；本组把内联 `<script>` 交给 jsdom 真跑
 * （与 `splash-log-scroll-follow.test.ts` 同一读法），夹具形状取自编排器 timeline
 * 的 span（`scripts/launcher-core/timeline.mjs` 的 `LaunchTimingSpan`）。
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

/** 单阶段耗时：与编排器 timeline 的 span 同形（endMs 为 null = 仍在进行）。 */
type Span = {
  durationMs: number;
  endMs: number | null;
  key: string;
  label: string;
  startMs: number;
};

/** 页面脚本在 jsdom 里暴露出来的那几件事（本组用例的读法，不是实现）。 */
type SplashInternals = {
  renderTimings: (timings: Span[] | null | undefined) => void;
};

/** 形状守卫替代断言收型：页面交出的必须是可调用的 renderTimings。 */
function isSplashInternals(value: unknown): value is SplashInternals {
  return (
    isRecord(value) && typeof (value as { renderTimings?: unknown }).renderTimings === "function"
  );
}

/**
 * 把启动页装载进**当前** jsdom 文档并跑它的脚本。
 * 定时器全部停掉、壳 IPC 与网络一律不可用——只关心「渲染一帧」这一动作。
 */
function bootSplash(): SplashInternals {
  document.documentElement.innerHTML = PAGE_HTML;

  Object.defineProperty(window, "setInterval", { configurable: true, value: () => 0 });
  Object.defineProperty(window, "setTimeout", { configurable: true, value: () => 0 });
  /* 页面自己的 warn 与本组用例无关（壳 IPC 与网络都不可用时各喊一嗓子），静音掉。 */
  window.console.warn = (): void => {
    /* 故意清空：只为吞掉页面的噪声 warn。 */
  };
  /* 页面每轮 tick 会探 /api/health。jsdom 里的 fetch 会真的往外发请求并被
   * vitest 记成未捕获错误——一律拒掉。 */
  window.fetch = () => Promise.reject(new Error("网络在用例里不可用"));

  const evaluated: unknown = window.eval(`${pageScript(PAGE_HTML)}\n;({ renderTimings })`);
  if (!isSplashInternals(evaluated)) {
    throw new Error("启动页脚本没有交出可调用的 renderTimings —— 内联脚本被改了？");
  }
  return evaluated;
}

/** 本机一次真实启动的读数（`run/launch-status.json` 原样抄录，#4327 现场）。 */
const REAL_TIMINGS: Span[] = [
  { key: "stale-reap", label: "回收上次残留", startMs: 264, endMs: 265, durationMs: 1 },
  { key: "env-toolchain", label: "环境与工具链", startMs: 265, endMs: 1969, durationMs: 1704 },
  { key: "deps-sync", label: "依赖对齐", startMs: 1969, endMs: 2045, durationMs: 76 },
  { key: "db-restore", label: "备份恢复", startMs: 2045, endMs: 2047, durationMs: 2 },
  { key: "port-resolve", label: "端口解析", startMs: 2047, endMs: 2047, durationMs: 0 },
  { key: "port-reclaim", label: "端口残留回收", startMs: 2050, endMs: 2670, durationMs: 620 },
  { key: "cache", label: "编译缓存", startMs: 2684, endMs: 5543, durationMs: 2859 },
  { key: "dev-spawn", label: "服务拉起", startMs: 5550, endMs: 5674, durationMs: 124 },
  { key: "schema-sync", label: "后台建表", startMs: 5686, endMs: 5786, durationMs: 100 },
  { key: "ready-wait", label: "等待服务就绪", startMs: 5799, endMs: 30_978, durationMs: 25_179 },
];

/** 逐行读数：行文本（label + 值）与条宽，按渲染顺序返回。 */
function readRows(): Array<{ fillWidth: string; label: string; text: string }> {
  return [...document.querySelectorAll("#timing-rows .timing-row")].map((row) => {
    const labelEl = row.querySelector(".timing-label");
    const fillEl = row.querySelector<HTMLElement>(".timing-fill");
    return {
      text: row.textContent ?? "",
      label: labelEl?.textContent ?? "",
      fillWidth: fillEl?.style.width ?? "",
    };
  });
}

describe("启动页耗时分解：密彩条改逐行可读（#4327）", () => {
  it("12 色密彩条已退役：源里不再有按序取色的调色板与分段条元素", () => {
    const script = pageScript(PAGE_HTML);
    expect(script, "按序循环取色的调色板不得回来").not.toContain("TIMING_COLORS");
    expect(PAGE_HTML, "分段细条元素不得回来").not.toContain("timing-strip");
  });

  it("timings 缺席 / 空数组 / 非数组 → 整块隐藏", () => {
    const splash = bootSplash();
    const wrap = document.getElementById("timings")!;
    for (const absent of [undefined, null, []]) {
      splash.renderTimings(absent);
      expect(wrap.style.display).toBe("none");
      expect(document.getElementById("timing-rows")!.childElementCount).toBe(0);
    }
  });

  it("逐行点名：按耗时降序取 ≥0.1s 的前 3 行，末行收「其余 N 段共 X s · 合计 Y s」", () => {
    const splash = bootSplash();
    splash.renderTimings(REAL_TIMINGS);
    const wrap = document.getElementById("timings")!;
    expect(wrap.style.display).toBe("block");
    const rows = readRows();
    expect(rows, "3 行点名 + 1 行其余段").toHaveLength(4);
    expect(rows.map((r) => r.label)).toEqual([
      "等待服务就绪",
      "编译缓存",
      "环境与工具链",
      "", // 末行是收拢行，没有阶段名
    ]);
    // 值列：秒数 · 占比（占比一位小数，口径与应用内卡一致；合计取墙钟 30714ms）
    expect(rows[0]?.text).toContain("25.2s · 82.0%");
    expect(rows[1]?.text).toContain("2.9s · 9.3%");
    expect(rows[2]?.text).toContain("1.7s · 5.5%");
    expect(rows[3]?.text).toBe("其余 7 段共 0.9s · 合计 30.7s");
    // 条宽按「该段 / 最长段」画：最长段占满轨道（口径与应用内卡一致）。
    // jsdom 的 cssstyle 会把 "100.00%" 规范化成 "100%"，按数值比较。
    expect(Number.parseFloat(rows[0]?.fillWidth ?? "")).toBeCloseTo(100);
    expect(Number.parseFloat(rows[1]?.fillWidth ?? "")).toBeCloseTo(11.35);
    expect(Number.parseFloat(rows[2]?.fillWidth ?? "")).toBeCloseTo(6.77);
  });

  it("进行中的段行尾标注「（进行中）」，合计把进行段算到当下为止", () => {
    const splash = bootSplash();
    splash.renderTimings([
      { key: "env-toolchain", label: "环境与工具链", startMs: 265, endMs: 1969, durationMs: 1704 },
      { key: "cache", label: "编译缓存", startMs: 2684, endMs: 5543, durationMs: 2859 },
      { key: "ready-wait", label: "等待服务就绪", startMs: 5799, endMs: null, durationMs: 8400 },
    ]);
    const rows = readRows();
    expect(rows.map((r) => r.label)).toEqual(["等待服务就绪", "编译缓存", "环境与工具链", ""]);
    expect(rows[0]?.text).toBe("等待服务就绪8.4s · 60.3%（进行中）");
    // 墙钟 = 进行段的当下延伸（5799+8400）− 最早起点（265）= 13935ms
    expect(rows[3]?.text).toBe("合计 13.9s");
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
});
