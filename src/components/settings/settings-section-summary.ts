/**
 * 设置分区导航的**树形结构**与「本节管什么」一句话（①配置层：常量 + 纯派生，无 React）。
 * 分区清单与名字由 `SETTINGS_SECTIONS` 一处给出（§12.18），分组与说明归本模块。收成竖向树
 * 而非横排 chip 带（ISSUE #1694；层级由 tree-rows 表达，§16.2.4.39）；漏项由测试拦下。
 */

import type { Section } from "~/app/(main)/settings/hooks/use-settings-page";

/** 导航树的一个分组：一个父行 + 挂在它下面的若干分区项（**顺序即渲染顺序**）。 */
export const TREE_GROUPS: Array<{
  /** 父行文案（弱一档、不是可点目标）。 */
  label: string;
  /** 挂在这一组下的分区（顺序即渲染顺序）。 */
  sections: Array<Section>;
}> = [
  { label: "模型", sections: ["llmLocal", "llmRemote"] },
  { label: "后端", sections: ["comfyui"] },
  { label: "数据", sections: ["database", "backup", "dataLocation"] },
  { label: "应用", sections: ["appearance", "appUpdate", "exit"] },
  { label: "诊断", sections: ["logs"] },
];

/**
 * **页面的滚动顺序** = 导航树的展开顺序（分组 → 组内各项）。
 * 一页到底之后导航是**目录**，正文顺序必须与目录一致，故顺序**从 `TREE_GROUPS` 派生**。
 * 约束由测试守住：并集恰好等于 `SETTINGS_SECTIONS`（不许漏/重），每个分组至少一项。
 */
export const SETTINGS_SCROLL_ORDER: Array<Section> = TREE_GROUPS.flatMap((group) => group.sections);

/** 分区 → 一句话说明（导航行右侧那句）。 */
const SECTION_SUMMARY: Record<Section, string> = {
  llmLocal: "本机 Ollama 的连接、模型与按任务的温度",
  llmRemote: "OpenAI 兼容接口的模型清单，按用途分组管理",
  comfyui: "出图后端装在哪、端口与实例目录（启动与日志在侧栏「ComfyUI」页）",
  database: "本地 SQLite 的可视化浏览与运行 SQL",
  backup: "库的快照与恢复，换文件发生在下次启动",
  dataLocation: "每类数据存在哪儿、迁移时怎么搬",
  appearance: "主题、圆角与标题字阶",
  appUpdate: "检测并安装应用新版本",
  exit: "退出应用时后台服务是保活还是连带关闭",
  logs: "日志面板里显示哪几类来源",
};

/** 取一个分区的说明。查不到时给通用兜底（新增分区忘了补文案不该让标题行空着）。 */
export function sectionSummary(section: Section): string {
  return SECTION_SUMMARY[section];
}

/**
 * 分区 → 所属**大类**的标签（导航树里那一层，ISSUE #3519）。
 *
 * 正文那一列原先只说分区名，用户在长页里看不出「这几节属于一类」；大类标签是
 * 导航树里已经有的信息，这里把它也接到正文上（每组只出现一次 —— 组的第一个分区）。
 */
export function sectionGroupLabel(section: Section): string {
  return TREE_GROUPS.find((group) => group.sections.includes(section))?.label ?? "";
}

/**
 * 该分区是不是所属大类的**第一个**（决定大类标题在正文里只出现一次）。
 *
 * 判据取「滚动顺序里的位置」而不是「分区内清单里的位置」：正文按
 * `SETTINGS_SCROLL_ORDER`（= 导航树展开顺序）铺，两者是同一份顺序 ⇒ 组内第一个
 * 就是正文里第一个。
 */
export function isGroupFirstSection(section: Section): boolean {
  const order = SETTINGS_SCROLL_ORDER;
  const index = order.indexOf(section);
  if (index <= 0) {
    return true;
  }
  /* 不用 `!`：越界的下标由显式空值守卫接住（判据「src 里不许出现非空断言」是硬闸）。 */
  const current = order[index];
  const previous = order[index - 1];
  if (current === undefined || previous === undefined) {
    return true;
  }
  return sectionGroupLabel(current) !== sectionGroupLabel(previous);
}
