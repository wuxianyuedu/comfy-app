/**
 * 调研页（脸库 / 风格库 / 服饰库 / 装饰库）预设的最小公共形状。
 * 与 `faces/face-preset-types.ts` 的 `FacePreset` 逐字段一致——四页的纯函数出口
 * 都吃这一份形状，视图只认它，新增一类库不再复制类型定义（规范 12 §12.12）。
 */
export type ResearchPreset = {
  /** 一句话中文说明（搜索与选中预览用）。 */
  description: string;
  /** 全库唯一 id。 */
  id: string;
  /** 本地工作流通道可用（false = 只能走远端 API 通道）。 */
  local: boolean;
  /** 中文名称（结果卡标题）。 */
  name: string;
  /** 英文正向提示词（不含统一前缀）。 */
  prompt: string;
  /** 搜索 / 筛选标签。 */
  tags: ReadonlyArray<string>;
};
