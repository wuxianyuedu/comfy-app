/** 一次测试的结果（工坊同款输出：图片 URL / 视频 URL / 对话回复文本）。
 *  叶子类型模块（§12.7）：生成动作与运行历史共用，避免两者互相 import 成环。 */
export type ModelTestResult =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "chat"; text: string }
  | null;
