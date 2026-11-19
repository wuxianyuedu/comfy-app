// 参考图装载预设路由（#4376）：预设清单的读 / 写，以及节点类目录的按需查询
// （预设编辑器加节点时按关键词搜 ComfyUI 的节点类；执行期的链生成读的是同一份
// 目录的编译结果 `reference-loader-catalog.ts`）。
import { z } from "zod";

import { authedProcedure, createTRPCRouter } from "~/server/api/trpc";
import { fetchObjectInfo } from "~/lib/comfyui/raw";
import {
  buildReferenceChainCatalog,
  type ReferenceChainClassDef,
} from "~/lib/comfyui/reference-loader-catalog";
import {
  loadReferenceLoaderPresets,
  saveReferenceLoaderPresets,
} from "~/lib/workshop/reference-loader-preset.server";
import { referenceLoaderPresetListSchema } from "~/lib/workshop/reference-loader-preset";

export const referenceLoaderRouter = createTRPCRouter({
  /* 生效的预设清单（本机覆盖优先，缺省回落随包清单）。 */
  presetsGet: authedProcedure.query(async () => {
    return { presets: await loadReferenceLoaderPresets() };
  }),

  /* 保存整份预设清单（全量覆盖；前端编辑器发的是归一后的完整清单）。 */
  presetsSave: authedProcedure
    .input(referenceLoaderPresetListSchema)
    .mutation(async ({ input }) => {
      return { presets: await saveReferenceLoaderPresets(input) };
    }),

  /* 节点类目录（按需）：`classes` 点名的类 + `search` 子串命中的类（大小写不敏感，
   * 封顶 80 条防整包下发）。ComfyUI 不可达 → `{ catalog: null }`，编辑器据此提示
   * 「需要 ComfyUI 在线」。 */
  nodeClasses: authedProcedure
    .input(
      z
        .object({
          classes: z.array(z.string().min(1)).max(64).optional(),
          search: z.string().max(120).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const catalog = buildReferenceChainCatalog(await fetchObjectInfo());
      if (catalog === null) {
        return { catalog: null };
      }
      /* 点名优先：给了 `classes` 就只回这些；否则按 `search` 子串过滤（封顶 80 条，
       * 防整包目录下发）。两者都没给 → 空目录（目录很大，不做无过滤的全量下发）。 */
      const wanted = input?.classes ?? null;
      const search = (input?.search ?? "").trim().toLowerCase();
      const out: Record<string, ReferenceChainClassDef> = {};
      for (const [name, def] of Object.entries(catalog)) {
        const hit =
          wanted === null
            ? search.length > 0 && name.toLowerCase().includes(search)
            : wanted.includes(name);
        if (hit) {
          out[name] = def;
        }
        if (Object.keys(out).length >= 80) {
          break;
        }
      }
      return { catalog: out };
    }),
});
