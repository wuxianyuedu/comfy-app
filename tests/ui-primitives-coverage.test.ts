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
 * ⚠️ 判据刻意**只钉已有落点、不要求穷尽**：清单是**显式**的，只保证
 * **已经用上的那一批不许掉回 0**（要摘掉一个必须改本文件，也就是必须在
 * Review 里讲清理由）。强行「为了用而用」会把外观改坏 —— 这与
 * §16.2.4.2 第 9 条「转换的验收标准是渲染结果不变」同源。
 *
 * ⚠️ **「有基元、无场景」这条判断本身必须逐条实测**（ISSUE #672 复查）：
 * 上一轮把 `tabs` / `accordion` / `scroll-area` / `avatar` / `alert` /
 * `dropdown-menu` / `form` 整批记成「本应用没有对应场景」，但实测下来
 * **七条里有五条是误判** —— 库内确实存在对应形态，只是当时按名字比、
 * 没按形态找（明细与证据见规范 16 §16.2.4.6）。这里把结论改成按**档**记，
 * 免得下一轮再照着这句「没有场景」跳过一遍：
 *   - `tabs` / `alert` / `dropdown-menu` —— 有明确落点，**欠治理**，已接上
 *   - `form`（`ui/form`，RHF 族）—— 那次**设计决定已做出**：**不进业务表单**，
 *     字段级规则改住 `src/lib/<domain>/*-schema.ts`（规范 16 §16.2.4.8）。
 *     本文件底部的 `FORM_DECISION` 把结论钉成可回归的事实
 *   - `accordion` / `avatar` —— 确有近似形态，但接上会改变外观或交互语义，
 *     **按现状不动**
 *   - `scroll-area` —— 判据在复查后**被更正**：此前说「高度由 flex 链推出、
 *     接不上」（其实 `Viewport` 是 `size-full`，flex 链推得出来），真正的阻塞
 *     是**五处全部需要 `ref` + `scrollTop` 的命令式滚动跟随**，而
 *     `ui/scroll-area` 不转发 viewport ref。同批复查发现更值钱的一条：
 *     库里有**两份自绘滚动条实现**（`.custom-scrollbar` 与视图文件里的
 *     任意值变体），已收口进 `globals.css` 并由 P4 硬闸守住
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
  "status-badge":
    "任务历史 / 执行日志 / 项目产出 / 画布节点 / 镜头卡的状态胶囊",
  "status-dot": "设置页状态行、工作流库宿主卡、库列表的「未载入」提示",
  /* 第一档三条（规范 16 §16.2.4.6）此前零引用，本批接上业务：
   * 页签落点是工作流库详情面板（自绘 TabButton 删除）；通知块落到
   * 登录页 / 训练页 / 设置页 / 节点错误面板 / 工坊三处错误行；
   * 下拉菜单落到画布右键菜单与项目切换器（两处自绘菜单 + 遮罩删除）。 */
  tabs: "工作流库详情面板的三页签",
  alert: "登录提示 / 训练后端横幅 / 设置页提示条 / 工坊错误行",
  "dropdown-menu": "画布右键菜单与项目切换器",
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

  /* ── 第二档 `ui/form` 的设计决定（规范 16 §16.2.4.6 / §16.2.4.8）─────
   *
   * 结论是「**不进业务表单**」：字段级规则改住 `src/lib/<domain>/*-schema.ts`
   * 的纯函数（首个落点 `~/lib/llm/remote-model-schema`），跨条目规则
   * （重名查重）留在 controller —— 那要看列表，不是纯字段判定。
   *
   * 为什么这条要有机器判据：上一轮把它记成「须先决策」就停在那里，
   * 而「另开一次设计决定」这种结论**不会被任何人复查** —— 它会一直挂在
   * 台账里，下一轮还得从头推一遍。钉成事实之后，要么它继续成立，要么
   * 有人显式改掉本用例并说明新的决策。 */
  it("表单校验规则的归属：字段级在 lib 的 schema 模块里，不在视图里", () => {
    const schemaPath = join(SRC, "lib", "llm", "remote-model-schema.ts");
    expect(statSync(schemaPath).isFile()).toBe(true);
    const schema = readFileSync(schemaPath, "utf8");
    // 纯函数：不碰 React，也不碰列表（集合级规则不在这里）。
    expect(schema).not.toMatch(/from\s+["']react["']/);
    expect(schema).toContain("validateRemoteModelFields");

    /* 视图只转述，不自己判定：`RemoteModelDialog` 里不得出现 zod / trim 校验。
       （视图消费 `d.fieldErrors` 是允许的 —— 那正是「controller 是唯一数据
       出入口」的形态。） */
    const dialogPath = join(
      SRC,
      "app",
      "(main)",
      "settings",
      "components",
      "RemoteModelDialog.tsx",
    );
    const dialog = readFileSync(dialogPath, "utf8");
    expect(dialog).not.toMatch(/from\s+["']zod["']/);
    expect(dialog).toContain("fieldErrors");
  });

  /* ── 按形态扫描：同一件事的「唯一出口」（规范 16 §16.2.4.10）──────────
   *
   * `check-ui-primitives.cjs` 的 P5/P6 是**硬闸**，判的是「视图里又写了一份」；
   * 这里补的是**另一侧**：出口模块自己的接口不许被绕过 —— 视图只能经它们
   * 拿到「写剪贴板 / 触发下载 / 格式化时间」这三件事的结果。
   *
   * 为什么要有这一层：P5/P6 只看 `navigator.clipboard` / `URL.createObjectURL`
   * 这两个**字面量**，而绕过的形态可以不含它们（例如自己包一层 `new Blob`
   * 却忘了 revoke、或自己写相对时间阈值）。用例逐个钉住出口模块存在 +
   * 导出的名字 + 至少一处业务引用。 */
  it.each([
    ["~/lib/browser-io", ["copyText", "downloadText", "downloadJson"]],
    ["~/lib/time-format", ["timeAgo", "formatClock"]],
  ] as const)("%s 是「按形态收口」的出口，且已被业务引用", (spec, exports) => {
    const mod = readFileSync(
      join(SRC, spec.replace("~/", "").replace(/\//g, sep) + ".ts"),
      "utf8",
    );
    for (const name of exports) {
      /* 导出形式：`export function <name>` 或 `export const <name>`。 */
      expect(mod, `${spec} 应导出 ${name}`).toMatch(
        new RegExp(`export (?:async )?(?:function|const) ${name}\\b`),
      );
    }
    /* 至少一处业务侧引用（排除自身与测试）。 */
    let refs = 0;
    for (const abs of collectImports(SRC)) {
      const rel = relative(SRC, abs).split(sep).join("/");
      if (rel.includes(".test.")) continue;
      if (abs === join(SRC, spec.replace("~/", "") + ".ts")) continue;
      if (readFileSync(abs, "utf8").includes(`"${spec}"`)) refs++;
    }
    expect(refs, `${spec} 没有任何业务引用（收口等于没做）`).toBeGreaterThan(0);
  });

  /**
   * 「隐藏文件选择框」的出口与消费点。
   *
   * P7 只看「同标签内 `type=file` + `hidden`」这一个形状，而绕过的形态可以不含
   * 它（例如 `<label htmlFor>` 隐式关联、或把 input 放进 `<template>`）。
   * 这一条从**另一侧**钉住：出口模块存在、导出的名字在、且真的有业务引用 ——
   * 「抽出出口但没人用」等于没做。
   */
  it("~/components/ui/file-picker 是隐藏文件选择框的出口，且已被业务引用", () => {
    const mod = readFileSync(
      join(SRC, "components", "ui", "file-picker.tsx"),
      "utf8",
    );
    for (const name of ["useFilePicker", "FilePickerButton", "FilePicker"]) {
      expect(mod, `file-picker 应导出 ${name}`).toMatch(
        new RegExp(`export (?:function|const) ${name}\\b`),
      );
    }
    /* 至少三处业务引用：本批迁移了 9 个落点，留一条远低于现状的门槛 ——
     * 它要挡的是「掉回 0 / 掉回 1」，不是锁死数量。 */
    let refs = 0;
    for (const abs of collectImports(SRC)) {
      const rel = relative(SRC, abs).split(sep).join("/");
      if (rel.startsWith("components/ui/")) continue;
      if (rel.includes(".test.")) continue;
      if (readFileSync(abs, "utf8").includes('"~/components/ui/file-picker"'))
        refs++;
    }
    expect(
      refs,
      "file-picker 的业务引用少于 3 处（收口可能被回退）",
    ).toBeGreaterThanOrEqual(3);
  });

  /* ── 「模态浮层」的出口与消费点（规范 16 §16.2.3 的 P9 / §16.2.4.11）──
   *
   * `check-ui-primitives.cjs` 的 P9 是**硬闸**，判的是「视图里又自绘了一份模态
   * 外壳」；这里补**另一侧**：`ui/dialog` 与 `ui/sheet` 必须真的被业务用着。
   *
   * 为什么两侧都要有：P9 数的是「另一种写法」，对「基元没人用」天然无感 ——
   * 而 16 处自绘浮层能长期存在，正是因为**没人觉得 `ui/dialog` 是必选项**
   * （它此前只有 4 个业务引用）。只加 P9 会挡住新增，但挡不住「下一个人的
   * 新弹窗又照抄一份自绘」。 */
  it("ui/dialog 是模态浮层的出口，且已被多处业务引用", () => {
    const mod = readFileSync(
      join(SRC, "components", "ui", "dialog.tsx"),
      "utf8",
    );
    for (const name of ["Dialog", "DialogContent"]) {
      expect(mod, `dialog 应导出 ${name}`).toMatch(
        new RegExp(`function ${name}(?=[^A-Za-z])`),
      );
    }
    /* 门槛留在现状之下（本批后是十处上下）：挡的是「掉回 0 / 掉回 1」。 */
    expect(
      consumerCount("dialog"),
      "ui/dialog 的业务引用过少（模态浮层可能又回退成各写一份）",
    ).toBeGreaterThanOrEqual(8);
  });

  it("ui/sheet 是抽屉形态的出口，且已被业务引用", () => {
    const mod = readFileSync(
      join(SRC, "components", "ui", "sheet.tsx"),
      "utf8",
    );
    for (const name of ["Sheet", "SheetContent"]) {
      expect(mod, `sheet 应导出 ${name}`).toMatch(
        new RegExp(`function ${name}(?=[^A-Za-z])`),
      );
    }
    expect(
      consumerCount("sheet"),
      "ui/sheet 的业务引用过少（抽屉可能又回退成各写一份）",
    ).toBeGreaterThanOrEqual(3);
  });

  it("ui/ 目录本身不空（判据没被绕过）", () => {
    const uiDir = join(SRC, "components", "ui");
    expect(statSync(uiDir).isDirectory()).toBe(true);
    const entries = readdirSync(uiDir).filter(
      (n) => n.endsWith(".tsx") && !n.includes(".test."),
    );
    expect(entries.length).toBeGreaterThan(20);
  });
});
