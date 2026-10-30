import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getConfigForClient } from "~/lib/llm/server";
import { remoteModelEntrySchema } from "~/lib/llm/remote-model-schema";
import { isHttpUrl } from "~/lib/url-scheme";
import { remoteModelRepository } from "~/lib/core/repository";
import {
  isCustomContractInputId,
  isModeContractInputId,
  parseRemoteModeAdapters,
  WORKSHOP_INPUT_TYPES,
} from "~/lib/workshop/model-mode-contract";
import { loadModeContracts, saveModeContracts } from "~/lib/workshop/mode-contract.server";

/** 适配器输入行：统一输入类型 → 请求体字段名 */
const adapterInputSchema = z.object({
  type: z.enum(
    /* SAFETY: 类型断言已复核 */ WORKSHOP_INPUT_TYPES.map((t) => t.type) as [
      string,
      ...Array<string>,
    ],
  ),
  field: z.string().min(1),
});
const adapterSchema = z.object({
  mode: z.string().min(1),
  endpointPath: z.string().min(1),
  inputs: z.array(adapterInputSchema).min(1),
  outputField: z.string().optional(),
});

/** 合法的任务类型 key（用于温度覆盖）。与 `TASK_TYPES`（~/lib/llm/types.ts）对齐——
 *  这里是「写入侧」白名单，漏了某个 key 的症状是：设置页能显示该档（读侧遍历
 *  TASK_TYPES）、保存时却被 zod 拒成 BAD_REQUEST。 */
const taskTypeKeys = /* SAFETY: 类型断言已复核 */ [
  "txt2img",
  "img2video",
  "chat",
  "code",
  "creative",
  "review",
] as const;

/** 候选模型条目：兼容旧纯名字字符串与新对象（远端条目可带独立接口 / 密钥）。
 *  对象那一半的形状**不在这里定义** —— 它与弹窗草稿写回的那一枚条目是同一份
 *  真相（`~/lib/llm/remote-model-schema` 的 `remoteModelEntrySchema`，含 `kind`
 *  的词表）。在这里再抄一份行内枚举，就是「弹窗能选、服务端不认」那种漂移的起点。 */
const extraModelsSchema = z.array(z.union([z.string(), remoteModelEntrySchema]));

export const llmRouter = createTRPCRouter({
  /* GET /api/llm/config —— 读 */
  configGet: authedProcedure.query(async () => {
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
