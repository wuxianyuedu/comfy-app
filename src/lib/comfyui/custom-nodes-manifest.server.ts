// ── 自定义节点扫描清单（manifest）在磁盘上的唯一位置与读取口径 ─────────────
//
// 这份 JSON 是只读 AST 解析器（`scripts/`→python）的产物：解析成功后写到
// `src/generated/customNodes.manifest.json`，界面上的「左下角页脚包名」「自定义节点
// 设置面板的节点预览卡」与「画布注册表」全都吃它。
//
// ## 为什么要单独一层
//
// 路径此前只有 `src/app/api/custom-nodes/route.ts` 里那一个 `MANIFEST` 常量，
// 而**读它的那两处**（摘要端点与清单端点）要各自决定「文件在不在」「读失败怎么说」——
// 两处各写一遍就会分叉：本仓已经为「地址 → 磁盘」的第二处实现付过一次学费
//（`firstframe.ts` 剥了 `api/` 段而 `compose-steps.ts` 没剥，于是「合成成片」对
// 每条产物必败；见规范 §12.12 与台账 A8）。所以「路径 + 指纹 + 三相比的读法」
// 只在这里定义一次，两个端点各自决定怎么把它回给客户端。
//
// ## 三相比两相多出来的那一档为什么要紧
//
// 旧的读法只有「有 / 没有」两相，于是「还没解析过」（正常冷启动）与
// 「读盘失败 / 不是合法 JSON」（真故障）在调用方看来同形 —— 界面上一律表现为
// 「节点数为 0」，而 0 恰好也是一个**合法**的解析结果。台账 E9 记的
// 「刷新不生效」就是这么被埋住的：客户端 `if (!res.ok) return 0` 把 404 与 500
// 一起吞了，而注册表恒空的唯一痕迹是一句没人看的 console.warn。
//
// §18.4 三选一：本模块走 `.server.ts`（第二类的服务端拆件）—— 它只被 Next 服务端的
// route handler 消费，读盘用 `node:fs`，视图层不许 import 它。
//
// @module comfyui/custom-nodes-manifest — 扫描清单的路径、指纹与按相读取

import fs from "node:fs";
import path from "node:path";

/** 清单文件名（相对仓库根）—— 解析器与读取侧共用这一个字面量。 */
export const CUSTOM_NODES_MANIFEST_REL = path.join(
  "src",
  "generated",
  "customNodes.manifest.json",
);

/** 清单的绝对路径（`root` 只为单测留的口子，生产调用一律默认 `process.cwd()`）。 */
export function customNodesManifestPath(root: string = process.cwd()): string {
  return path.join(root, CUSTOM_NODES_MANIFEST_REL);
}

/**
 * 清单的内容指纹：`<size>:<mtime 秒>`。
 *
 * 文件只在解析 / 流式解析收尾时被写，写完指纹必变 —— 摘要端点用它做「不必重新解析
 * 整份几百 KB」的短路缓存。`null` = 读不到（不存在或无权限），此时调用方不许缓存。
 */
export function customNodesManifestStamp(
  root: string = process.cwd(),
): string | null {
  try {
    const st = fs.statSync(customNodesManifestPath(root));
    return `${st.size}:${Math.trunc(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

/** 按相读取的结果：三相互斥，调用方据此给出不同的话与状态码。 */
export type CustomNodesManifestRead =
  | { kind: "ok"; text: string; stamp: string | null }
  /** 文件不存在 —— 「还没有解析过」，是正常状态不是故障。 */
  | { kind: "missing" }
  /** 文件在但读不出来（权限 / 竞态删除 / IO 错）—— 真故障。 */
  | { kind: "unreadable"; detail: string };

/**
 * 读清单原文（不解析：谁需要结构化字段谁自己 `JSON.parse`，摘要端点要的只是其中一角）。
 *
 * `stamp` 只在 `kind: "ok"` 时给出，且允许为 null（刚读到内容又 stat 失败的竞态）——
 * 调用方据此决定「能不能进缓存」，而不是拿一个旧指纹冒充新内容。
 */
export function readCustomNodesManifest(
  root: string = process.cwd(),
): CustomNodesManifestRead {
  const file = customNodesManifestPath(root);
  try {
    // 单次 readFileSync 就够：文件只被解析器整体覆写，不存在半写入的中间态可读
    // （写侧是 `fs.writeFileSync`），而几百 KB 的读盘开销远小于一次 JSON.parse。
    return {
      kind: "ok",
      text: fs.readFileSync(file, "utf8"),
      stamp: customNodesManifestStamp(root),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", detail: `${code ?? "unknown"}` };
  }
}
