/**
 * 设置分区导航的分段表与「本节管什么」一句话（①配置层：常量 + 纯派生，无 React）。
 *
 * 两件事各有一个出处，别混：
 *   · **有哪些分区、每一项叫什么** —— 仍由 `use-settings-page-types.ts` 的
 *     `SETTINGS_SECTIONS` 一处给出（它是分区表，视图不许重抄一遍，§12.18）；
 *   · **哪几项排在同一行** + **每一项的一句话说明** —— 本模块。分段与文案都是
 *     「导航怎么呈现」的决定，与分区本身是什么无关，所以它归导航这一侧。
 *
 * `sections` 里每一项都必须是 `Section` 类型（漏写一项由
 * `SettingsShell.test.tsx` 报红 —— 静默漏项正是这张表的失效模式：
 * 某个分区从导航上消失，而界面其它地方都不会说）。
 *
 * ## 分区说明为什么在导航这一侧，而不是各区卡片里
 *
 * 各分区卡片此前在正文开头写一段「本分区是什么」的解释（数据库那一节、
 * 备份那一节、退出那一节各有一次），而那段话回答的是**导航问题**
 *（「我现在在哪、这一节管什么」），不是配置问题 —— 它读一遍就不需要了，
 * 却常年占着正文最靠上的位置，把真正的第一个控件推到折叠线以下。
 * 收在导航里之后，同一句话只写一次，且出现在用户**挑分区的那一瞬**。
 *
 * 因此本表**只写「答案在别处拿不到的那句话」**（时间口径 / 数据来源 / 能做什么），
 * 不写「管理你的模型」这类同义反复 —— 与 `ui/page-header` 的 `description`
 * 是同一条口径（§16.2.4.73）。
 */
import type { Section } from "~/app/(main)/settings/hooks/use-settings-page";

/** 一行 chip 的段位（只回答「哪几项排在一起」）。 */
export const SETTINGS_SECTION_GROUPS: {
  label: string;
  sections: Section[];
}[] = [
  { label: "模型", sections: ["llmLocal", "llmRemote"] },
  { label: "后端", sections: ["comfyui"] },
  { label: "数据", sections: ["database", "backup"] },
  { label: "应用", sections: ["appearance", "appUpdate", "exit", "logs"] },
];

/** 分区 → 一句话说明（导航行右侧那句）。 */
const SECTION_SUMMARY: Record<Section, string> = {
  llmLocal: "本机 Ollama 的连接、模型与按任务的温度",
  llmRemote: "OpenAI 兼容接口的模型清单，按用途分组管理",
  comfyui: "出图后端的路径、端口与实例目录",
  database: "本地 SQLite 的可视化浏览与运行 SQL",
  backup: "库的快照与恢复，换文件发生在下次启动",
  appearance: "主题、圆角与标题字阶",
  appUpdate: "检测并安装应用新版本",
  exit: "退出应用时后台服务是保活还是连带关闭",
  logs: "日志面板里显示哪几类来源",
};

/** 取一个分区的说明。查不到时给通用兜底（新增分区忘了补文案不该让标题行空着）。 */
export function sectionSummary(section: Section): string {
  return SECTION_SUMMARY[section] ?? "本分区的配置";
}
