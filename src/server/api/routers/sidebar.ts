import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";
import {
  loadSidebarTabConfig,
  loadSidebarTabProjectDefaults,
  resetSidebarTabConfig,
  saveSidebarTabConfig,
  saveSidebarTabConfigAsProjectDefaults,
} from "~/lib/shell/sidebar-tab-behavior.server";

/** 一份配置的入参形状：视图 id → 两档行为。
 *
 *  值域由 zod 收（`independent` / `shared`），非法档位在**入参**这一层就被打回，
 *  不进落盘侧 —— 手改坏的配置是「读不出来按没有覆盖处理」，而界面发出来的这份
 *  必须是合法的（否则用户会得到一句「保存成功」却什么都没变）。
 *
 *  外层包一层 `config`：入参是「一份配置」而不是「配置本身」—— 后面再加字段
 *  （比如「连同标签一起改」）不用改这条口的名字。 */
const sidebarTabConfigSchema = z.object({
  config: z.record(z.string().min(1), z.enum(["independent", "shared"])),
});

/**
 * 界面页签的行为（ISSUE #3623 / #3798）。
 *
 * 「工作区的全局视图点开后是独立标签页还是共享标签页」是**应用级配置**：它管的是
 * 全部全局视图（含不进侧栏的「设置」与「UI 控件总览」），与当前项目无关 ——
 * 与「设置」同族，故归这一族而不是塞进 `setting` 路由（那边是应用偏好 / 后端配置）。
 * 配置是 map 形状、键为任意非空视图 id，新增视图只需在项目默认 JSON 里补一行，
 * 不必动这里的 zod 白名单。
 *
 * 两种保存方式与「模式契约」同一条口径：
 *   · `tabConfigSave` —— 落**本机**（`data/`），开发版与正式包都能用；
 *   · `tabConfigSaveProjectDefaults` —— 落**项目默认**（入库 JSON，跟代码走），
 *     只有开发检出有可写的目标文件。
 */
export const sidebarRouter = createTRPCRouter({
  /**
   * 读生效配置（项目默认 + 本机覆盖）。
   *
   * 一并下发「项目默认」那份：设置页要拿它当「还原默认」的基准与差集基准，
   * 界面自己再存一份就会与磁盘上的那份漂移。`projectDefaultEditable` 供界面决定
   * 要不要渲染「保存为项目默认」—— 只有开发检出有可写的目标文件。
   */
  tabConfigGet: authedProcedure.query(async () => {
    const [config, projectDefaults] = await Promise.all([
      loadSidebarTabConfig(),
      loadSidebarTabProjectDefaults(),
    ]);
    return { config, projectDefaults, projectDefaultEditable: isDevCheckout() };
  }),

  /** 「保存」：落本机覆盖（差集化后写 `data/sidebar-tab-behavior.json`）。 */
  tabConfigSave: authedProcedure.input(sidebarTabConfigSchema).mutation(async ({ input }) => {
    await saveSidebarTabConfig(input.config);
    // 回下发生效值：界面拿它刷新草稿（差集落盘后生效值 = 项目默认 + 差集）。
    return { config: await loadSidebarTabConfig() };
  }),

  /** 「保存为项目默认（跟代码走）」：全量写进入库 JSON。
   *  只有开发检出可用 —— 正式包大声失败（判据与出口都在服务端那一层）。 */
  tabConfigSaveProjectDefaults: authedProcedure
    .input(sidebarTabConfigSchema)
    .mutation(async ({ input }) => {
      const { config, file } = await saveSidebarTabConfigAsProjectDefaults(input.config);
      return { config, file };
    }),

  /** 「还原默认」：删掉本机覆盖，生效值回落项目默认。 */
  tabConfigReset: authedProcedure.mutation(async () => {
    return { config: await resetSidebarTabConfig() };
  }),
});
