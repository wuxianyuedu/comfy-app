import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getConfigForClient } from "~/lib/llm/server";
import { remoteModelEntrySchema } from "~/lib/llm/remote-model-schema";
import {
  LLM_API_FORMATS,
  MODEL_CAPABILITIES,
  MODEL_INPUT_TYPES,
  MODEL_OUTPUT_TYPES,
  isMediaEndpointKind,
  resolveApiFormat,
  resolveMediaEndpointPath,
} from "~/lib/llm/provider-types";
import { isHttpUrl } from "~/lib/url-scheme";
import { llmProviderRepository, remoteModelRepository } from "~/lib/core/repository";
import type { LlmProvider, RemoteModel } from "~/server/db/schema";
import {
  isCustomContractInputId,
  isModeContractInputId,
  parseRemoteModeAdapters,
  WORKSHOP_INPUT_TYPES,
} from "~/lib/workshop/model-mode-contract";
import {
  loadModeContractLayers,
  resetModeContractOverride,
  saveModeContracts,
  saveModeContractsAsProjectDefaults,
} from "~/lib/workshop/mode-contract.server";
import { isDevCheckout } from "~/lib/shell/dev-checkout.server";

/** 适配器输入行：统一输入类型 → 请求体字段名 */
const adapterInputSchema = z.object({
  /* zod v4 的 `z.enum` 带 `const T extends readonly string[]`：直接吃同一份
   * 词表派生的数组即可，字面量联合原样保留，无需断言成元组。 */
  type: z.enum(WORKSHOP_INPUT_TYPES.map((t) => t.type)),
  field: z.string().min(1),
});
const adapterSchema = z.object({
  /* 固定值字段（#3590）：每次请求原样带上的键值（如 Agnes 视频的 mode/size）。 */
  constants: z.array(z.object({ field: z.string().min(1), value: z.string() })).optional(),
  mode: z.string().min(1),
  endpointPath: z.string().min(1),
  inputs: z.array(adapterInputSchema).min(1),
  outputField: z.string().optional(),
});

/** 合法的任务类型 key（用于温度覆盖）。与 `TASK_TYPES`（~/lib/llm/types.ts）对齐——
 *  这里是「写入侧」白名单，漏了某个 key 的症状是：设置页能显示该档（读侧遍历
 *  TASK_TYPES）、保存时却被 zod 拒成 BAD_REQUEST。 */
/* SAFETY: 类型断言已复核 */
const taskTypeKeys = ["txt2img", "img2video", "chat", "code", "creative", "review"] as const;

/** 候选模型条目：兼容旧纯名字字符串与新对象（远端条目可带独立接口 / 密钥）。
 *  对象那一半的形状**不在这里定义** —— 它与弹窗草稿写回的那一枚条目是同一份
 *  真相（`~/lib/llm/remote-model-schema` 的 `remoteModelEntrySchema`，含 `kind`
 *  的词表）。在这里再抄一份行内枚举，就是「弹窗能选、服务端不认」那种漂移的起点。 */
const extraModelsSchema = z.array(z.union([z.string(), remoteModelEntrySchema]));

/** 供应商入参（#3501）：Base URL 必须是 http/https（与 configSave 同一判据）。
 *  `apiKey` 三态：缺键 = 不动既有、`null`/空白 = 清空、非空串 = 写入新值。
 *  `apiFormat` 自 #3517 起下移到模型级，这里省略 = 不动既有（历史供应商的协议
 *  不该被一次「改个名字」的保存改回默认）。 */
const providerInputSchema = z.object({
  apiFormat: z.enum(LLM_API_FORMATS).optional(),
  apiKey: z.string().nullish(),
  baseUrl: z.string().refine(isHttpUrl, { message: "Base URL 必须为 http/https" }),
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, "供应商名称不能为空"),
});

/** 模型入参（#3501）：窗口 / 输出上限必须是正整数（0 与负数在上游都无意义）。
 *  `apiFormat` 是模型级接口格式（#3517）：省略 = 跟随供应商（历史行）。 */
const modelInputSchema = z.object({
  apiFormat: z.enum(LLM_API_FORMATS).nullish(),
  apiKey: z.string().nullish(),
  baseUrl: z.string().nullish(),
  capabilities: z.array(z.enum(MODEL_CAPABILITIES)).nullish(),
  contextWindow: z.number().int().positive().nullish(),
  /** 图像 / 视频模型的接口端点动作路径（#3656）：写侧按行用途白名单收窄。 */
  endpointPath: z.string().nullish(),
  enabled: z.boolean().optional(),
  id: z.string().min(1).optional(),
  inputTypes: z.array(z.enum(MODEL_INPUT_TYPES)).nullish(),
  outputTypes: z.array(z.enum(MODEL_OUTPUT_TYPES)).nullish(),
  kind: z.enum(["chat", "image", "video"]).optional(),
  maxOutputTokens: z.number().int().positive().nullish(),
  name: z.string().trim().min(1, "模型名称不能为空"),
  providerId: z.string().min(1),
  reasoningLevels: z.array(z.string()).nullish(),
  reasoningParamMapping: z
    .object({ param: z.string(), values: z.record(z.string(), z.string()) })
    .nullish(),
  smartConfig: z.boolean().optional(),
});

/** 供应商下发给客户端的形状：密钥只报「有没有配」。 */
function providerView(p: LlmProvider) {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiFormat: p.apiFormat,
    hasApiKey: typeof p.apiKey === "string" && p.apiKey !== "",
  };
}

/** 模型下发给客户端的形状：密钥只报「有没有配」（供应商级密钥不在这里重复报）。
 *  `apiFormat` 下发的是**生效值**（模型自己的 → 供应商默认 → chat-completions）：
 *  设置页的模型行与编辑弹窗都按它显示，不再各自回落一次。
 *  指向已删除供应商的行 `find` 自然取不到，格式回落默认值，不因一条孤儿行报错。
 *  `endpointPath`（#3656）同口径：图像 / 视频行下发生效值（库里值按用途白名单
 *  收窄 → 默认第一项），文本行恒 null。 */
function modelView(m: RemoteModel, providers: ReadonlyArray<LlmProvider>) {
  const provider = providers.find((p) => p.id === m.providerId);
  return {
    id: m.id,
    providerId: m.providerId,
    name: m.name,
    kind: m.kind,
    enabled: m.enabled,
    baseUrl: m.baseUrl,
    apiFormat: resolveApiFormat(m.apiFormat, provider?.apiFormat),
    endpointPath: isMediaEndpointKind(m.kind)
      ? resolveMediaEndpointPath(m.kind, m.endpointPath)
      : null,
    hasApiKey: typeof m.apiKey === "string" && m.apiKey !== "",
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    inputTypes: m.inputTypes,
    outputTypes: m.outputTypes,
    capabilities: m.capabilities,
    reasoningLevels: m.reasoningLevels,
    reasoningParamMapping: m.reasoningParamMapping,
    smartConfig: m.smartConfig,
  };
}

/** 供应商 + 模型全量视图（每条写操作都回这一份，前端不必自己拼状态）。 */
async function readProviderState() {
  /* 历史遗留模型先归入默认供应商：这一步幂等，且必须在 list 之前 ——
   * 否则首次打开设置页会看到一组「无主」模型，用户不知道该挂到哪个供应商下。 */
  await llmProviderRepository.ensureLegacyProvider();
  const [providers, models] = await Promise.all([
    llmProviderRepository.list(),
    remoteModelRepository.list(),
  ]);
  return {
    providers: providers.map(providerView),
    models: models.map((m) => modelView(m, providers)),
  };
}

/** 一条模式契约的入参形状（本机保存与「保存为项目默认」共用同一份，ISSUE #3396）。
 *  口 id 由 isModeContractInputId 做类型守卫（zod 随之把入参窄化成契约口）；
 *  写入侧各自的归一化（`parseModeContracts`）再做一次。 */
const modeContractsInputSchema = z.object({
  contracts: z.array(
    z.object({
      mode: z.string().min(1),
      // 契约口是工坊对用户的统一口径（尺寸 / 参考图…），**不是**适配器侧的
      // 输入类型（aspect-ratio / megapixels…）。曾误用 WORKSHOP_INPUT_TYPES
      // 校验，保存含「尺寸」的契约直接被 zod 打回（Invalid option …）。
      inputs: z
        .array(
          z.string().refine(isModeContractInputId, {
            message:
              "契约口必须是 prompt|negative|size|duration|reference-image|first-frame|last-frame（第 2 张起的参考图带序号，如 reference-image-2）、或自定义口 custom-text-1 / custom-image-2 / custom-number-3",
          }),
        )
        .min(1),
      output: z.enum(["image", "video", "audio"]),
      /* 该模式的必备口（缺了它这条流在工坊里驱动不起来）。缺省 =
       * 没配过 → 由 requiredInputsFor 回落内置默认（提示词）。 */
      required: z.array(z.string().refine(isModeContractInputId)).optional(),
      /* 作者自定义的口：名字由作者填，类型是「简单类型」之一（决定工坊
       *  控件形态与它接受哪一族端口）。归一化（丢弃无定义的口）在
       *  `parseModeContracts` 里再做一次。 */
      customInputs: z
        .array(
          z.object({
            id: z.string().refine(isCustomContractInputId, {
              message: "自定义口 id 形如 custom-text-1 / custom-image-2",
            }),
            label: z.string().min(1),
            kind: z.enum(["text", "image", "number"]),
          }),
        )
        .optional(),
    }),
  ),
});

export const llmRouter = createTRPCRouter({
  /* GET /api/llm/config —— 读 */
  configGet: authedProcedure.query(async () => {
    const cfg = await getConfigForClient();
    return { config: cfg };
  }),

  /** 供应商 + 模型全量清单（#3501「远程模型」页的数据源）。 */
  providersGet: authedProcedure.query(async () => readProviderState()),

  /** 新建 / 更新供应商；返回全量视图（前端不必自己拼状态）。 */
  providerSave: authedProcedure.input(providerInputSchema).mutation(async ({ input }) => {
    await llmProviderRepository.save(input);
    return readProviderState();
  }),

  /** 删除供应商及其名下模型。 */
  providerDelete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await llmProviderRepository.delete(input.id);
      return readProviderState();
    }),

  /** 新建 / 更新供应商下的一条模型。 */
  modelSave: authedProcedure.input(modelInputSchema).mutation(async ({ input }) => {
    await remoteModelRepository.saveModel(input);
    return readProviderState();
  }),

  /** 删除一条模型。 */
  modelDelete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await remoteModelRepository.deleteModel(input.id);
      return readProviderState();
    }),

  /** 启用 / 停用一条模型（停用的模型不下发给工坊下拉）。 */
  modelToggle: authedProcedure
    .input(z.object({ enabled: z.boolean(), id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await remoteModelRepository.setEnabled(input.id, input.enabled);
      return readProviderState();
    }),

  /** 模式契约注册表：每种模式的统一输入 / 输出。
   *
   *  下发**两层**：`configured` = 成品配置（项目默认基线，开发检出里现读磁盘，
   *  写完即生效不必重启）；`contracts` = 生效注册表（成品配置逐模式压上本机
   *  覆盖）。界面读 `contracts` 显示与编辑，读 `configured` 判「已改」——
   *  两层各给一份，省得界面自己再合一次（合的规则只有一处：`mode-contract-registry`）。
   *  `projectDefaultEditable` 供界面决定要不要渲染「保存为项目默认」——
   *  只有开发检出有可写的目标文件（ISSUE #3396）。 */
  modeContractsGet: authedProcedure.query(async () => {
    const { configured, contracts } = await loadModeContractLayers();
    return { configured, contracts, projectDefaultEditable: isDevCheckout() };
  }),

  modeContractsSave: authedProcedure.input(modeContractsInputSchema).mutation(async ({ input }) => {
    // 口 id 由 isModeContractInputId 做类型守卫（zod 随之把入参窄化成契约口），
    // saveModeContracts 内部再做一次契约归一化。
    await saveModeContracts(input.contracts);
    // 返回**保存后的生效注册表**（覆盖落盘 → 重读三层），界面据此刷新，
    // 不用再等一次查询往返。
    const { contracts } = await loadModeContractLayers();
    return { contracts };
  }),

  /** 「保存为项目默认」：编辑器现状**全量**写进入库 JSON（跟代码走）。
   *  只有开发检出可用 —— 正式包大声失败（判据与出口都在
   *  `saveModeContractsAsProjectDefaults`）。写完读取侧现读磁盘 ⇒ 不必重启。 */
  modeContractsSaveProjectDefaults: authedProcedure
    .input(modeContractsInputSchema)
    .mutation(async ({ input }) => {
      const { file } = await saveModeContractsAsProjectDefaults(input.contracts);
      // 重读三层：刚写进项目默认的那份立刻成为成品配置，生效注册表随之更新
      // （界面这一跳就能看到新口径，不必重启应用）。
      const { contracts } = await loadModeContractLayers();
      return { contracts, file };
    }),

  /** 「还原默认」：把一个模式从本机覆盖里移除（生效值回落成品配置）。
   *  返回移除后的生效注册表与该模式的生效契约（界面直接拿它刷新草稿）。 */
  modeContractReset: authedProcedure
    .input(z.object({ mode: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { effective } = await resetModeContractOverride(input.mode);
      const { contracts } = await loadModeContractLayers();
      return { contracts, effective };
    }),

  /** 读取某条远端模型的工坊模式适配器 */
  workshopAdaptersGet: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input }) => {
      const adapters = await remoteModelRepository.getWorkshopAdapters(input.name);
      return { adapters };
    }),

  /** 保存某条远端模型的工坊模式适配器（整份覆盖） */
  workshopAdaptersSave: authedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        adapters: z.array(adapterSchema),
      }),
    )
    .mutation(async ({ input }) => {
      const adapters = parseRemoteModeAdapters(
        input.adapters.map((a) => ({ ...a, mode: a.mode.toUpperCase() })),
      );
      const saved = await remoteModelRepository.saveWorkshopAdapters(input.name, adapters);
      return { adapters: saved };
    }),

  /* POST /api/llm/config —— 新建：update singleton config */
  configSave: authedProcedure
    .input(
      z.object({
        provider: z.enum(["local", "remote"]).optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().refine(isHttpUrl, { message: "baseUrl 必须为 http/https" }).optional(),
        model: z.string().optional(),
        /** 候选清单：字符串=本地 ollama 候选；对象=远端独立模型（写入 remoteModel 表） */
        extraModels: extraModelsSchema.optional(),
        temperature: z.number().optional(),
        temperatureByTask: z.record(z.enum(taskTypeKeys), z.number()).optional(),
        maxTokens: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { saveLlmSettings } = await import("~/lib/core/repository");
      /* 两张表（远端模型清单 / llmConfig 单例）在同一次事务里落定，事务边界与
       * 「哪一条候选落哪张表」的拆分都在仓库层的那个入口里 —— 路由这里只说一句
       * 「存」，不再自己决定写入范围（ISSUE #2592）。 */
      await saveLlmSettings(input);
      // 回传脱敏配置（不携带明文 apiKey，改发 hasApiKey 布尔），与 configGet 同源。
      // 这一读**提交之后**才发生：读侧一致性不归本事务管，别把它搬进去。
      const config = await getConfigForClient();
      return { config };
    }),
});
