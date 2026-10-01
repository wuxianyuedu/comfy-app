/**
 * 首页「模型概览」的推导（纯函数，不碰 React、不碰网络）。
 *
 * 单独成模块的理由：这一步才是这块界面**唯一有判断力**的地方（哪些目录该列、
 * 按什么排、空目录怎么交代、加载中与取数失败怎么区分）。把它挂在 hook 里就得
 * 为了测它去 mock 整条 tRPC；放这里则是一组普通输入输出。
 */

/** `model.configList` 返回的目录行里，本模块用到的那几项。 */
export interface OverviewFolder {
  folder: string;
  label: string;
  count: number;
}

/** 概览里的一类模型。 */
export interface ModelOverviewGroup {
  /** 目录名（计数口径的身份）。 */
  folder: string;
  /** 展示名（与模型目录配置弹层同一个出处 `folderMeta`）。 */
  label: string;
  count: number;
}

export interface ModelOverviewState {
  /** 有模型的目录，按数量降序；空目录不列（列出来只会稀释信息）。 */
  groups: ModelOverviewGroup[];
  /** 本机可用模型的总数。 */
  total: number;
  /** 有多少个目录一个模型都没有 —— 用一句话交代，而不是不声不响地少列。 */
  emptyFolderCount: number;
  loading: boolean;
  /** 取数失败时给一句可见说明（硬规则 4：失败路径要有用户可见出口）。 */
  error: string | null;
}

export function deriveModelOverview(input: {
  folders: OverviewFolder[] | undefined;
  loading: boolean;
  /** 只传「是不是失败了」这个布尔：错误文案的唯一出处在本模块，
   *  把 Error 对象传进来等于允许调用方各写一句。 */
  isError: boolean;
}): ModelOverviewState {
  const folders = input.folders ?? [];
  const withModels = folders
    .filter((folder) => folder.count > 0)
    .map((folder) => ({
      folder: folder.folder,
      label: folder.label,
      count: folder.count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    groups: withModels,
    total: withModels.reduce((sum, group) => sum + group.count, 0),
    emptyFolderCount: folders.length - withModels.length,
    /* 只有「确实失败了」才算失败。首帧 isLoading 且还没有数据时是 loading，
       不该被说成错误 —— 那会让每次冷启动都闪一句「读不到」。 */
    loading: input.loading,
    error: input.isError ? "模型计数暂时读不到" : null,
  };
}
