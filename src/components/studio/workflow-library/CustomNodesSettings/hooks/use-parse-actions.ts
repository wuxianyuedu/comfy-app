/**
 * 「解析」三个入口（全部 / 单条子包 / 单个父目录下全部子包）。单独成文件是为了让
 * useCustomNodesSettings 回到 §12.13 的 400 行内；刻意不 `useCallback`：拆分前
 * 就是每次渲染重声明的普通函数，加了反而引入旧闭包问题。
 */
import type { Dispatch, SetStateAction } from "react";

import type { useBusyAction } from "~/components/ui/use-busy-action";

import type { DiscoveredSubpkg } from "../types";

/** 这三个入口读/写的那些东西（由主 hook 原样传下来）。 */
export type ParseActionsDeps = {
  clearPerPkgParsing: (pkgPath: string) => void;
  discoveredByParent: Record<string, Array<DiscoveredSubpkg>>;
  parseBusy: ReturnType<typeof useBusyAction>;
  runParse: (packages?: Array<string>) => Promise<void>;
  savedPaths: Array<string>;
  setError: (msg: string | null) => void;
  setPerPkgParsing: Dispatch<SetStateAction<Record<string, boolean>>>;
  setReport: (report: null) => void;
};

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
