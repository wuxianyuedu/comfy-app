/**
 * UI 控件总览的分区清单（ISSUE #4125）—— 左侧大类导航与各分区 `id` 的**唯一出处**。
 *
 * 此前分区标题散在各自的 ui-kit-gallery-*.tsx 里，左侧导航若再手抄一份 id，
 * 改名 / 增删分区时两边必然漂移（导航点过去跳空）。这份表把 id 与标题钉在一处：
 * 导航组件读它渲染，各分区的 `<GallerySection id={...}>` 也读它取 id。
 * `as const` 让 id 成为字面量类型，拼错在编译期就红。
 */
export const UI_KIT_CATEGORIES = [
  { id: "ui-kit-tokens", title: "语义 token 墙" },
  { id: "ui-kit-primitives", title: "基元 UI 速览" },
  { id: "ui-kit-actions", title: "按钮、徽标与状态件" },
  { id: "ui-kit-forms", title: "输入与选择" },
  { id: "ui-kit-overlays", title: "浮层与对话框" },
  { id: "ui-kit-navigation", title: "导航与布局" },
  { id: "ui-kit-status", title: "反馈与状态" },
  { id: "ui-kit-data", title: "数据展示与杂项" },
] as const;

export type UiKitCategoryId = (typeof UI_KIT_CATEGORIES)[number]["id"];

/** 具名 id，供各分区 `<GallerySection id={CATEGORY_IDS.xxx}>` 引用（避免手抄字面量）。 */
export const CATEGORY_IDS = {
  actions: "ui-kit-actions",
  data: "ui-kit-data",
  forms: "ui-kit-forms",
  navigation: "ui-kit-navigation",
  overlays: "ui-kit-overlays",
  primitives: "ui-kit-primitives",
  status: "ui-kit-status",
  tokens: "ui-kit-tokens",
} as const satisfies Record<string, UiKitCategoryId>;
