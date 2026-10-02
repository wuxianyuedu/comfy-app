import { describe, expect, it } from "vitest";

import {
  anchoredOverlayBoundary,
  titleBarHeightPx,
  FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS,
  FULL_SCREEN_LAYER_CLASS,
  STATUS_BAR_CLEARANCE_CLASS,
  TITLE_BAR_CHROME_CLASS,
  TITLE_BAR_HEIGHT_CLASS,
  TITLE_BAR_HEIGHT_REM,
  TITLE_BAR_HEIGHT_VAR,
  TITLE_BAR_TOP_CLASS,
  fullScreenLayerClass,
  OVERLAY_POSITION_CLASS,
  blocksTitleBar,
  overlayClass,
} from "./full-screen-layer";
import { zClass } from "./shell/overlay-z";
import { REM_PX } from "./layout-budget";

describe("全屏视图层定位（ISSUE #310 回归）", () => {
  it("让出窗口标题行：顶部用 top-title-bar，而不是 inset-0", () => {
    // `fixed inset-0` 会把标题行里的页签整条盖住 —— 用户从此看不到、也切不回
    // 其它页签。这是本 ISSUE 的回归点，锁定为显式断言。
    expect(FULL_SCREEN_LAYER_CLASS).not.toContain("inset-0");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("top-title-bar");
  });

  it("四边都锚定：铺满标题行下方的内容区（底部必须显式 bottom-0）", () => {
    // 只用 top/left/right 会靠内容高度撑开，全屏视图需要被拉伸到内容区高度。
    expect(FULL_SCREEN_LAYER_CLASS).toContain("top-title-bar");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("bottom-0");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("right-0");
    expect(FULL_SCREEN_LAYER_CLASS).toContain("left-0");
  });

  it("让出底部状态栏的全屏层：顶部让标题行、底边停在状态栏上沿", () => {
    // 状态栏（BrowserStatusBar）是 fixed bottom-0 h-6 的 z-toast 悬浮层：
    // 铺到 bottom-0 的浮层最后 24px 会被它压住（日志全屏视图实测
    // 「最后几行看不到」），所以底边是 bottom-6 而不是 bottom-0。
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).toContain("top-title-bar");
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).toContain(
      STATUS_BAR_CLEARANCE_CLASS,
    );
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).toContain("bottom-6");
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).not.toContain("bottom-0");
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).not.toContain("inset-0");
    // 四边显式锚定：依赖内容撑高会让「铺满」退化成「随内容长」。
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).toContain("right-0");
    expect(FULL_SCREEN_LAYER_ABOVE_STATUS_BAR_CLASS).toContain("left-0");
  });

  it("标题行高度与 CSS 变量同源（改高度时两处一起改）", () => {
    // tailwind v4 只有 `--spacing-<name>` 命名空间会生成 `top-<name>` 工具类；
    // 自定义名（如 --title-bar-height）产出 0 个类，全屏视图会静默退回 top:auto
    // 而被标题行盖住 —— 把这条约束钉在测试里，防止改回自定义名。
    expect(TITLE_BAR_HEIGHT_VAR).toBe("--spacing-title-bar");
    expect(TITLE_BAR_HEIGHT_VAR.startsWith("--spacing-")).toBe(true);
    expect(TITLE_BAR_TOP_CLASS).toBe("top-title-bar");
    expect(TITLE_BAR_HEIGHT_CLASS).toBe("h-title-bar");
    expect(TITLE_BAR_HEIGHT_REM).toBe("2.25rem");
    // 让位用的 top 类必须与标题行自身高度类同源。
    expect(FULL_SCREEN_LAYER_CLASS).toContain(TITLE_BAR_TOP_CLASS);
  });

  it("标题行的层级由常量给出：relative + 刻度表最高档 z-chrome", () => {
    // 让位只管「不被盖住」，不管「可点」：base-ui 的 modal 会往 body 注入
    // `fixed inset-0 z-index:auto pointer-events:auto` 的 InternalBackdrop，
    // 标题行停在 `z-index: auto` 就会被它压住命中测试（ISSUE #310 第三次回归：
    // 设置页启动日志全屏后窗口按钮整排点不动）。
    expect(TITLE_BAR_CHROME_CLASS).toContain("relative");
    expect(TITLE_BAR_CHROME_CLASS).toContain(zClass("chrome"));
    expect(zClass("chrome")).toBe("z-chrome");
  });
});

describe("fullScreenLayerClass", () => {
  it("拼接定位 + z-index + 视图自身布局", () => {
    expect(fullScreenLayerClass("z-modal", "flex flex-col bg-bg")).toBe(
      `${FULL_SCREEN_LAYER_CLASS} z-modal flex flex-col bg-bg`,
    );
  });

  it("zClass 与 extra 都可省，且不产生重复空格", () => {
    expect(fullScreenLayerClass("z-toast")).toBe(
      `${FULL_SCREEN_LAYER_CLASS} z-toast`,
    );
    expect(fullScreenLayerClass("z-modal", "")).toBe(
      `${FULL_SCREEN_LAYER_CLASS} z-modal`,
    );
  });
});

describe("浮层让位判据（ISSUE #310 弹窗类回归）", () => {
  it("模态弹窗也要让出标题行：顶部 top-title-bar + bottom-0", () => {
    // 弹窗只浮在内容区之上，不必铺满；但顶部同样不能让掉 ——
    // 否则页签与右上角的窗口按钮会被整条盖住。
    expect(OVERLAY_POSITION_CLASS.modal).toContain(TITLE_BAR_TOP_CLASS);
    expect(OVERLAY_POSITION_CLASS.modal).toContain("bottom-0");
    expect(OVERLAY_POSITION_CLASS.modal).not.toContain("inset-0");
  });

  it("全屏视图与模态弹窗同源取让位量", () => {
    expect(OVERLAY_POSITION_CLASS.full).toBe(FULL_SCREEN_LAYER_CLASS);
    expect(OVERLAY_POSITION_CLASS.full).toContain(TITLE_BAR_TOP_CLASS);
  });

  it("overlayClass 拼接定位 + 其余 class，且不产生重复空格", () => {
    expect(overlayClass("modal", "z-modal flex items-center bg-black/60")).toBe(
      `${OVERLAY_POSITION_CLASS.modal} z-modal flex items-center bg-black/60`,
    );
    expect(overlayClass("modal")).toBe(OVERLAY_POSITION_CLASS.modal);
  });
});

describe("blocksTitleBar：门禁用的「盖标题行」判定", () => {
  it("认出会让位的写法", () => {
    expect(blocksTitleBar(FULL_SCREEN_LAYER_CLASS)).toBe(false);
    expect(blocksTitleBar(OVERLAY_POSITION_CLASS.modal)).toBe(false);
    // 让位后再加 z-index / 居中布局，仍属合规
    expect(
      blocksTitleBar(overlayClass("modal", "z-modal flex items-center")),
    ).toBe(false);
  });

  it("认出会让位的旧写法 fixed inset-0", () => {
    expect(
      blocksTitleBar("fixed inset-0 z-modal flex items-center justify-center"),
    ).toBe(true);
    expect(blocksTitleBar("fixed inset-0")).toBe(true);
    expect(blocksTitleBar("  fixed   inset-0   z-modal  ")).toBe(true);
  });

  it("不误伤非顶层浮层：absolute / 局部定位 / 另一套尺寸", () => {
    // 只铺自己的定位祖先，够不到标题行
    expect(blocksTitleBar("absolute inset-0 pointer-events-none")).toBe(false);
    // 底层 app shell 的固定元素（如底部状态栏）不在选择器内
    expect(blocksTitleBar("fixed bottom-0 left-0 right-0 z-toast")).toBe(false);
    // 另给偏移的写法不是这两个词紧邻出现
    expect(blocksTitleBar("fixed top-2 inset-0")).toBe(false);
    expect(blocksTitleBar("fixed inset-x-0 top-0")).toBe(false);
    // 非 fixed 开头
    expect(blocksTitleBar("grid h-[85vh] inset-0")).toBe(false);
  });
});

describe("锚定浮层的碰撞边界（气泡被标题行吃掉半个身子那件事）", () => {
  /* 现场：TopBar 那排按钮落在 y≈46，气泡默认往上摆（`side="top"`）时顶部
   * 落在 y≈14 —— **视口内绰绰有余**，于是 Base UI 的 `flip` 不翻转；而标题行
   * 占 0~36、层级 `z-chrome`(2000) 比气泡的 `z-popup`(100) 高一个数量级，
   * 气泡上半截被标题行盖掉（画在它下面，不是被裁）。实测四个入口全中招。 */
  it("壳态：可用区域从标题行下沿起算（顶上那条让出去）", () => {
    expect(anchoredOverlayBoundary({ width: 1440, height: 900 }, 36)).toEqual({
      x: 0,
      y: 36,
      width: 1440,
      height: 864,
    });
  });

  it("非壳态（浏览器 / dev）：整视口可用，行为一字不变", () => {
    expect(anchoredOverlayBoundary({ width: 1440, height: 900 }, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });
  });

  it("还不知道视口多大时返回 null —— 不拿假矩形摆位", () => {
    // 与 `useViewportSize` 首帧为 `null` 同一口径：调用处据此**不传这一档**，
    // 退回基元默认的 `clipping-ancestors`。
    expect(anchoredOverlayBoundary(null, 36)).toBeNull();
    expect(anchoredOverlayBoundary({ width: 0, height: 800 }, 36)).toBeNull();
    expect(anchoredOverlayBoundary({ width: 1280, height: 0 }, 36)).toBeNull();
  });

  it("让位量夹在视口内：比标题行还矮的窗口不产生负高度", () => {
    // 负高度的边界会让定位引擎算出一串无意义的偏移 —— 宁可退化成整视口。
    expect(
      anchoredOverlayBoundary({ width: 800, height: 20 }, 36)?.height,
    ).toBe(0);
    expect(anchoredOverlayBoundary({ width: 800, height: 900 }, -5)?.y).toBe(0);
  });

  it("标题行高度与 globals.css 的 --spacing-title-bar 同源（不各写一个数）", () => {
    // 换算基准就是 TITLE_BAR_HEIGHT_REM（`2.25rem`），漂移由这条断言拦下：
    // 它是 `globals.css` 里 `--spacing-title-bar` 的那档值。
    expect(titleBarHeightPx(16)).toBe(36);
    expect(titleBarHeightPx(20)).toBe(45);
    // 默认基准 = Tailwind 的根字号（`layout-budget` 的 REM_PX）
    expect(titleBarHeightPx()).toBe(titleBarHeightPx(REM_PX));
    expect(`${titleBarHeightPx()}`).toBe(
      `${Number.parseFloat(TITLE_BAR_HEIGHT_REM) * REM_PX}`,
    );
  });
});
