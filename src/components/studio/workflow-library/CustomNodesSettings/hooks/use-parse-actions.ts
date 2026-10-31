/**
 * 「解析」那三个入口（全部 / 单条子包 / 单个父目录下的全部子包）。
 *
 * 为什么单独一份：它们此前是 `useCustomNodesSettings` 里的四段内联函数，而这个组件
 * hook 在 oxlint `curly` 那批机械改写后越过了 §12.13 的函数长度硬闸（400 行）。
 * 拆的边界是**这几个动作自己**：它们只读「当前已配路径 / 已发现的子包 / 忙碌位」，
 * 写「进度与错误」，与主 hook 的状态编排是两件事。
 *
 * ⚠️ 这里刻意**不** `useCallback`：与拆分前逐字等价（原先就是每次渲染重新声明的
 * 普通函数，`return` 出去的那几个入口因此本来就每轮换引用）。加 `useCallback`
 * 会把「依赖数组写少了 = 读到旧闭包」这类新问题引进来，而这次改动只做搬家。
 */
import type { Dispatch, SetStateAction } from "react";

import type { useBusyAction } from "~/components/ui/use-busy-action";

import type { DiscoveredSubpkg } from "../types";

/** 这三个入口读/写的那些东西（由主 hook 原样传下来）。 */
export interface ParseActionsDeps {
  clearPerPkgParsing: (pkgPath: string) => void;
  discoveredByParent: Record<string, Array<DiscoveredSubpkg>>;
  parseBusy: ReturnType<typeof useBusyAction>;
  runParse: (packages?: Array<string>) => Promise<void>;
  savedPaths: Array<string>;
  setError: (msg: string | null) => void;
  setPerPkgParsing: Dispatch<SetStateAction<Record<string, boolean>>>;
  setReport: (report: null) => void;
}

export function createParseActions({
  savedPaths,
  discoveredByParent,
  parseBusy,
  setError,
  setReport,
  setPerPkgParsing,
  runParse,
  clearPerPkgParsing,
}: ParseActionsDeps) {
  async function onParseAll() {
    if (savedPaths.length === 0) {
      setError("未找到自定义节点目录 —— 请先在设置 → 创作后端 中配置 ComfyUI 安装路径");
      return;
    }
    setReport(null);
    await parseBusy.run(() => runParse());
  }

  async function onParseSingle(pkgPath: string) {
    /* 按子包的忙碌位**不是一个布尔**（一屏多个子行各跑各的），所以它不走
     *  `useBusyAction` —— 那一条账管的是「一次动作一块界面忙不忙」。 */
    setPerPkgParsing((parsing) => ({ ...parsing, [pkgPath]: true }));
    try {
      await runParse([pkgPath]);
    } finally {
      clearPerPkgParsing(pkgPath);
    }
  }

  /** 一次性重新解析单个已配置父目录下的所有子包。复用同一子集解析路径，只是一次传 N
   *  个绝对路径。空/缺失目录由解析器自身容忍（记录日志并跳过）。 */
  async function onParseAllParent(parent: string) {
    const subs = discoveredByParent[parent] ?? [];
    const targets = subs.map((sub) => sub.path).filter(Boolean);
    if (targets.length === 0) {
      setError("该目录下没有可解析的子包");
      return;
    }
    await parseBusy.run(() => runParse(targets));
  }

  return { onParseAll, onParseSingle, onParseAllParent };
}
