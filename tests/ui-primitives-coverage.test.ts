/**
 * UI 基元「被用起来」的契约（ISSUE #672 / 规范 16 §16.2.4）。
 *
 * 背景：ISSUE #672 的体检把三件事分开看 —— ① 手写 `<button>` / 自建 portal /
 * 自写 spinner（由 `scripts/check-ui-primitives.cjs` 的 P1/P2/P3 棘轮管）；
 * ② 目录归并（由 `tests/ui-kit-single-home.test.ts` 管）；**③ 基元齐全但没人用**。
 * 第三条是这轮剩下最久的一条账：`ui/` 里 29 个基元，业务侧只用到了寥寥几个，
 * 「卡片 / 徽标 / 输入框 / 文本域 / 开关 / 页签 / 分隔线」这一批基元的
 * 引用数是 **0**（名字见本文件底部的消费点清单）。
 *
 * 为什么 ③ 需要单独的判据：P1/P2/P3 数的是「**另一种写法**」出现了几次，
 * 而「零引用的基元」是**没有出现**的那一侧 —— 棘轮对「什么都不写」天然无感。
 * 上一批把 `ui/card` / `ui/badge` / `ui/textarea` / `ui/switch` / `ui/separator`
 * 接上业务之后，用本文件把「接上了」变成不可回退的事实。
 *
 * ⚠️ 判据刻意**只钉已有落点、不要求穷尽**：`ui/` 里还有若干基元（`tabs` /
 * `accordion` / `scroll-area` / `avatar` / `alert` / `dropdown-menu` / `form`）
 * 在本应用里**没有对应场景**（工作流库的页签是自绘 chip、告警走 toast、
 * 表单校验走 RHF 之外的路径）。强行「为了用而用」会把外观改坏 —— 这与
 * §16.2.4.2 第 9 条「转换的验收标准是渲染结果不变」同源。所以这里只保证：
 * **已经用上的那一批不许掉回 0**，且清单是**显式**的（要摘掉一个必须改本文件，
 * 也就是必须在 Review 里讲清理由）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/**
 * 必须有业务引用的基元 → 至少一处真实消费点（2026-09 接入的那一批）。
 *
 * 值只用于失败时点名「谁掉回零了」，不参与断言计算。
 */
const REQUIRED_CONSUMERS: Record<string, string> = {
  card: "模型卡片（ModelCard 的卡片外壳）",
  badge: "模型卡片上的类型徽标",
  input: "设置页 / 表单里的文本输入",
  textarea: "设置页提示词、工作流导入 JSON、影片剧本",
  switch: "画布设置与项目设置抽屉的开关",
  separator: "影片工作台的分隔线",
  "range-slider": "训练超参与画布设置滑块",
  /* 下面两个此前**从来没被 ui/ 外部引用过**：状态胶囊在七个文件里各写一份
   * 字面量配色，状态圆点在四处各写一份（规范 16 §16.2.4.5）。 */
  "status-badge": "任务历史 / 执行日志 / 项目产出 / 画布节点 / 镜头卡的状态胶囊",
  "status-dot": "设置页状态行、工作流库宿主卡、库列表的「未载入」提示",
};

/** 逐文件收集业务侧（非 ui/ 自身、非测试）的 import 说明符。 */
function collectImports(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__snapshots__" || entry.name === "__tests__")
        continue;
      collectImports(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** 业务侧引用 `~/components/ui/<name>` 的文件数（不含 ui/ 内部互相引用）。 */
function consumerCount(name: string): number {
  const pattern = new RegExp(
    `from\\s+["']~/components/ui/${name.replace(/[-]/g, "\\-")}["']`,
  );
  let n = 0;
  for (const abs of collectImports(SRC)) {
    const rel = relative(SRC, abs).split(sep).join("/");
    if (rel.startsWith("components/ui/") && !rel.includes(".test.")) continue;
    if (pattern.test(readFileSync(abs, "utf8"))) n++;
  }
  return n;
}

describe("UI 基元被业务用起来（规范 16 §16.2.4）", () => {
  it.each(Object.entries(REQUIRED_CONSUMERS))(
    "ui/%s 至少有一个业务消费点（%s）",
    (name) => {
      expect(
        consumerCount(name),
        `ui/${name} 的引用数回到了 0 —— 它此前已经接上业务（本清单里逐条登记）。` +
          `若确实要把某处改回自实现，请先按 §16.2.3 说明理由并从本清单里摘掉；` +
          `「基元齐全但没人用」正是 ISSUE #672 里最难收的一条账。`,
      ).toBeGreaterThan(0);
    },
  );

  it("ui/ 目录本身不空（判据没被绕过）", () => {
    const uiDir = join(SRC, "components", "ui");
    expect(statSync(uiDir).isDirectory()).toBe(true);
    const entries = readdirSync(uiDir).filter(
      (n) => n.endsWith(".tsx") && !n.includes(".test."),
    );
    expect(entries.length).toBeGreaterThan(20);
  });
});
