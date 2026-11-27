/**
 * 工作流里钉死的模型文件在本机是否可用（ISSUE #5144）。
 *
 * MiniMax H3 把文本编码器文件名写死在图里（int8 那份 25.9GB）；换一台内存更小的
 * 机器就加载失败，而报错只是一句 `HostBuffer.read_file_slice failed`。这里提供
 * 「从图里扫出所有模型文件名 → 与本机已扫到的清单比对」的唯一出口：
 * 纯函数负责形状，异步壳只负责取本机清单，不另造扩展名 / 目录映射。
 */
import { localModelFileNames } from "~/lib/models";
import { FIELD_TO_FOLDERS, isModelFileName } from "~/lib/model-types";

/** 从 RAW（UI 格式，控件值在 widgets_values）或 API 图（inputs[].value）里扫模型文件名。 */
export function modelFileNamesInGraph(graph: unknown): Array<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (isModelFileName(value)) {
        found.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) {
        visit(item);
      }
    }
  };
  visit(graph);
  return [...found];
}

/** 纯派生：图里引用但本机没有的模型文件名（保序、去重）。 */
export function missingModelFiles(graph: unknown, available: ReadonlySet<string>): Array<string> {
  return modelFileNamesInGraph(graph).filter((name) => !available.has(name));
}

/** 异步壳：从已扫到的本机模型清单取可用名，再交给纯函数比对。 */
export async function missingModelsForGraph(graph: unknown): Promise<Array<string>> {
  const folders = [...new Set(Object.values(FIELD_TO_FOLDERS).flat())];
  const available = await localModelFileNames(folders);
  return missingModelFiles(graph, new Set(available));
}
