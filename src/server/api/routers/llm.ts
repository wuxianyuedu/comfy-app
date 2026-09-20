import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  getLLMConfig,
  completeLLM,
  ensureRemoteStorageMigrated,
  getConfigForClient,
} from "~/lib/llm/server";
import { splitExtraModels } from "~/lib/llm/types";
import { remoteModelRepository } from "~/lib/core/repository";
import {
  isCustomContractInputId,
  isModeContractInputId,
  parseRemoteModeAdapters,
  WORKSHOP_INPUT_TYPES,
} from "~/lib/workshop/model-mode-contract";
import {
  loadModeContracts,
  saveModeContracts,
} from "~/lib/workshop/mode-contract.server";

/** 适配器输入行：统一输入类型 → 请求体字段名 */
const adapterInputSchema = z.object({
  type: z.enum(
    WORKSHOP_INPUT_TYPES.map((t) => t.type) as [string, ...string[]],
  ),
  field: z.string().min(1),
});
const adapterSchema = z.object({
  mode: z.string().min(1),
  endpointPath: z.string().min(1),
  inputs: z.array(adapterInputSchema).min(1),
  outputField: z.string().optional(),
});

/** 合法的任务类型 key（用于温度覆盖） */
const taskTypeKeys = [
  "txt2img",
  "img2video",
  "chat",
  "code",
  "creative",
] as const;

/** 候选模型条目：兼容旧纯名字字符串与新对象（远端条目可带独立接口 / 密钥） */
const extraModelsSchema = z.array(
  z.union([
    z.string(),
    z.object({
      name: z.string().min(1),
      baseUrl: z.string().nullish(),
      apiKey: z.string().nullish(),
      kind: z.enum(["chat", "image", "video"]).nullish(),
    }),
  ]),
);

export const llmRouter = createTRPCRouter({
  /* GET /api/llm/config —— 读 */
  configGet: authedProcedure.query(async () => {
    await ensureRemoteStorageMigrated();
    const cfg = await getConfigForClient();
    return { config: cfg };
  }),

  /** 模式契约注册表：每种模式的统一输入 / 输出（只含用户改过的模式） */
  modeContractsGet: authedProcedure.query(async () => {
    const contracts = await loadModeContracts();
    return { contracts };
  }),

  modeContractsSave: authedProcedure
    .input(
      z.object({
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
            required: z
              .array(z.string().refine(isModeContractInputId))
              .optional(),
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
      }),
    )
    .mutation(async ({ input }) => {
      // 口 id 由 isModeContractInputId 做类型守卫（zod 随之把入参窄化成契约口），
      // saveModeContracts 内部再做一次契约归一化。
      const contracts = await saveModeContracts(input.contracts);
      return { contracts };
    }),

  /** 读取某条远端模型的工坊模式适配器 */
  workshopAdaptersGet: authedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input }) => {
      const adapters = await remoteModelRepository.getWorkshopAdapters(
        input.name,
      );
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
      const saved = await remoteModelRepository.saveWorkshopAdapters(
        input.name,
        adapters,
      );
      return { adapters: saved };
    }),

  /* POST /api/llm/config —— 新建：update singleton config */
  configSave: authedProcedure
    .input(
      z.object({
        provider: z.enum(["local", "remote"]).optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
        /** 候选清单：字符串=本地 ollama 候选；对象=远端独立模型（写入 remoteModel 表） */
        extraModels: extraModelsSchema.optional(),
        temperature: z.number().optional(),
        temperatureByTask: z
          .record(z.enum(taskTypeKeys), z.number())
          .optional(),
        maxTokens: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { llmConfigRepository, remoteModelRepository } =
        await import("~/lib/core/repository");
      await ensureRemoteStorageMigrated();
      // option C：远端模型与本地候选分开存。把提交的候选清单按类型拆分：
      //   字符串 → llmConfig.extraModels（本地候选，无 apiKey）
      //   对象   → remoteModel 表（远端独立模型）
      const split = splitExtraModels(input.extraModels);
      if (input.extraModels !== undefined) {
        await remoteModelRepository.replaceAll(split.remoteEntries);
      }
      const config = await llmConfigRepository.upsertSingleton({
        ...input,
        // 本地候选只写名字字符串（无 extraModels 输入时保持原值）；远端条目已落
        // remoteModel 表，llmConfig 不再承载远端对象，避免两类混存。
        extraModels:
          input.extraModels !== undefined ? split.localNames : undefined,
      });
      return { config };
    }),

  /* POST /api/llm —— 新建：non-streaming completion */
  complete: authedProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          }),
        ),
        provider: z.enum(["local", "remote"]).optional(),
        model: z.string().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
        taskType: z.enum(taskTypeKeys).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const cfg = await getLLMConfig({
        // P0:provider 收紧为 enum——垃圾值此前会静默按 local 误路由,
        // 现在输入非法直接 400(Zod),不再静默回退。
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        taskType: input.taskType,
      });
      const content = await completeLLM(cfg, input.messages);
      return { content };
    }),
});
