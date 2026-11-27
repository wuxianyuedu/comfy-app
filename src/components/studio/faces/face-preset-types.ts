/** 一条脸部形象预设（数据文件与纯函数出口共用的唯一类型）。 */
export type FacePreset = {
  /** 一句话中文说明（搜索用）。 */
  description: string;
  id: string;
  local: boolean;
  name: string;
  /** 英文正向提示词（脸部长特写）。 */
  prompt: string;
  /** 搜索 / 筛选标签：脸型 / 眼型 / 瞳色 / 发型 / 表情 / 气质 / 题材。 */
  tags: ReadonlyArray<string>;
};
