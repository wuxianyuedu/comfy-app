/**
 * 角色库的展示常量（ISSUE #5009）：状态词表的中文名与徽标配色。
 * 纯数据 + 纯函数（规范 17 §17.2 第①层），视图与卡片共用这一份，不各写各的。
 */

/** 角色档案状态 → 展示名。 */
export const CHARACTER_STATUS_LABELS: Record<string, string> = {
  draft: "待生成",
  generating: "生成中",
  ready: "已就绪",
  failed: "失败",
};

/** 状态徽标的配色（语义 token：成功 / 进行 / 失败 / 中性）。 */
export function characterStatusClass(status: string): string {
  switch (status) {
    case "ready": {
      return "bg-success-soft text-success-strong";
    }
    case "generating": {
      return "bg-primary-soft text-primary-strong";
    }
    case "failed": {
      return "bg-danger-soft text-danger-strong";
    }
    default: {
      return "bg-black/55 text-white";
    }
  }
}

/** 状态过滤档的取值（「全部」+ 四态；路由 zod 同款词表）。 */
export type CharacterStatusFilter = "all" | "draft" | "generating" | "ready" | "failed";

/** 状态过滤档（列表工具行的「全部 + 四态」）。 */
export const CHARACTER_STATUS_FILTERS: Array<{ key: CharacterStatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "draft", label: "待生成" },
  { key: "generating", label: "生成中" },
  { key: "ready", label: "已就绪" },
  { key: "failed", label: "失败" },
];

/** 预置数量的档位（角色库首铺 / 扩充用）。 */
export const CHARACTER_SEED_PRESETS = [100, 300, 500, 1000] as const;
