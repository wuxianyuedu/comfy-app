"use client";

/**
 * 「实际使用」测试弹窗的交互状态与动作（规范 17 §17.2 第②层）。
 * 网络动作在 controller，这里只收拢弹窗交互态（参数草稿 / 进行态 / 结果 / 额外字段行编辑）；
 * 模块级草稿仓库 `usageTestDrafts` 按 `kind + 条目名` 保留「关闭再重开」的表单内容，纯视图偏好、不入库。
 */

import { useEffect, useState } from "react";

import {
  defaultUsageTestPath,
  defaultVideoFields,
  usageFieldsToJson,
  usageTestDraftKey,
  type UsageField,
} from "~/lib/llm/usage-test-config";
import type { UsageTestKind, UsageTestResult } from "~/lib/llm/usage-test-client";
import type { RemoteModelEntry } from "~/lib/llm/types";

import type { ReadySettingsPageController } from "./use-settings-page";
import { createUsageFieldEditor, type UsageFieldEditor } from "./usage-field-editor";

/** 「实际使用」测试弹窗的状态：参数可自定义，结果按用途渲染。 */
export type UsageTestDialogState = {
  apiKey: string;
  baseUrl: string;
  entry: RemoteModelEntry;
  /** 请求体额外字段（结构化编辑，替代原先手填整段 JSON）。 */
  fields: Array<UsageField>;
  kind: UsageTestKind;
  path: string;
  prompt: string;
  /** 是否正在「继续等待」一个已提交的异步视频任务（区别于首次提交的 running） */
  querying: boolean;
  result: UsageTestResult | null;
  running: boolean;
  size: string;
};

/** 每个条目「实际使用」测试弹窗的草稿快照：不含运行时 running / entry 引用，
 *  只保留「重开可恢复」的填写内容与最近一次执行结果 / 状态。
 *  关闭弹窗不丢内容（ISSUE #107）：重开同一 kind + 条目的弹窗时据此恢复。 */
export type UsageTestDialogSnapshot = {
  apiKey: string;
  baseUrl: string;
  fields: Array<UsageField>;
  kind: UsageTestKind;
  name: string;
  path: string;
  prompt: string;
  result: UsageTestResult | null;
  size: string;
};

/** 模块级草稿仓库：键 = usageTestDraftKey(kind, name)。
 *  放在模块作用域而非组件 state，是为了「关闭弹窗」也能保留——
 *  关闭只把组件内的 usageTest 置 null，仓库里的快照仍在，重开即恢复。 */
const usageTestDrafts = new Map<string, UsageTestDialogSnapshot>();

/** 把当前弹窗状态压成可恢复的快照存进仓库。running 恒不存：关闭再重开不应
 *  误认为「还在跑」，最近一次执行的结果在 result 里体现即可。 */
function rememberUsageTestDraft(state: UsageTestDialogState): void {
  const key = usageTestDraftKey(state.kind, state.entry.name);
  usageTestDrafts.set(key, {
    kind: state.kind,
    name: state.entry.name,
    baseUrl: state.baseUrl,
    path: state.path,
    apiKey: state.apiKey,
    prompt: state.prompt,
    size: state.size,
    fields: state.fields.map((f) => ({ ...f })),
    result: state.result,
  });
}

/** 若存在对应草稿快照则返回，否则返回 null（调用方按默认值新建弹窗）。 */
function restoreUsageTestDraft(kind: UsageTestKind, name: string): UsageTestDialogSnapshot | null {
  return usageTestDrafts.get(usageTestDraftKey(kind, name)) ?? null;
}

/** 弹窗状态 / 动作 + 额外字段行编辑器（后者的动作集合见 `usage-field-editor`）。 */
export type UsageTestDialogs = UsageFieldEditor & {
  /** 关闭「实际使用」弹窗（草稿仍在仓库，重开可恢复）。 */
  closeUsageTest: () => void;
  /** 对已提交但仍在生成的异步视频任务「继续等待」一轮。 */
  continueUsageWait: () => Promise<void>;
  /** 打开「实际使用」测试弹窗（按用途预填，重开恢复草稿）。 */
  openUsageTest: (kind: UsageTestKind, entry: RemoteModelEntry) => void;
  /** 局部更新弹窗里的受控输入（提示词 / 尺寸等）。 */
  patchUsageTest: (patch: Partial<UsageTestDialogState>) => void;
  /** 发起一次真实调用（图片 / 视频会真实生成、消耗额度）。 */
  runUsageTest: () => Promise<void>;
  /** 「实际使用」测试弹窗状态（null = 关闭）。 */
  usageTest: UsageTestDialogState | null;
};

/** 「实际使用」测试弹窗的交互状态与动作。
 *
 * @param c 设置页 controller（网络侧动作都在它上面）
 */
export function useUsageTestDialogs(c: ReadySettingsPageController): UsageTestDialogs {
  const [usageTest, setUsageTest] = useState<UsageTestDialogState | null>(null);

  /* 弹窗打开期间每次状态变化都存入草稿仓库：这样无论点关闭 / ✕ / 点遮罩，
   * 关闭后的下次重开都能从仓库恢复已填内容与最近一次执行结果。 */
  useEffect(() => {
    if (usageTest) {
      rememberUsageTestDraft(usageTest);
    }
  }, [usageTest]);

  /* 字段行编辑器是一个自洽的交互面（只读写 usageTest.fields），已切到
   * `./usage-field-editor`；状态仍由本 hook 一处持有，子模块只提供动作。 */
  const editor = createUsageFieldEditor(setUsageTest);

  /** 打开「实际使用」测试弹窗：按用途预填端点路径与提示词
   *  （路径预填是纯函数 `defaultUsageTestPath`，单测在 usage-test-config.test）。 */
  function openUsageTest(kind: UsageTestKind, entry: RemoteModelEntry) {
    const base = entry.baseUrl ?? "";
    const prompts: Record<UsageTestKind, string> = {
      chat: "用一句话介绍你自己",
      image: "一只戴宇航员头盔的柴犬，写实风格，高清",
      video: "一只柴犬在草地上奔跑，阳光明媚，电影感",
    };
    const path = defaultUsageTestPath(kind, base);
    /* 若该 kind + 条目此前打开过并填过内容（含上次执行结果 / 状态），
     * 关闭后重开时恢复，而不是回到默认预填——内容不因关闭而丢。 */
    const prev = restoreUsageTestDraft(kind, entry.name);
    setUsageTest({
      kind,
      entry,
      baseUrl: prev?.baseUrl ?? base,
      path: prev?.path ?? path,
      apiKey: prev?.apiKey ?? "",
      prompt: prev?.prompt ?? prompts[kind],
      size: prev?.size ?? "",
      /* 视频接口普遍必填 mode（如 Agnes：text / keyframe / reference）。
       * 这里直接给一行可见、可改的 mode 字段，替代原先手填整段 JSON；
       * 改成 keyframe 再补一行 first_frame 图即可走首帧模式。 */
      fields:
        prev?.fields && prev.fields.length > 0
          ? prev.fields.map((f) => ({ ...f }))
          : kind === "video"
            ? defaultVideoFields()
            : [],
      /* 关闭再重开不延续「运行中」——从草稿恢复的是已填内容 + 最近一次结果 */
      running: false,
      querying: false,
      result: prev?.result ?? null,
    });
  }

  function closeUsageTest() {
    setUsageTest(null);
  }

  function patchUsageTest(patch: Partial<UsageTestDialogState>) {
    setUsageTest((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function runUsageTest() {
    if (!usageTest || usageTest.running) {
      return;
    }
    setUsageTest({ ...usageTest, running: true, result: null });
    /* 弹窗留空 → 用草稿条目里的密钥（未保存的条目也有）：
     * 只靠服务端按名字查已保存配置，会漏掉「加了条目还没点保存」的情况，
     * 表现为 401 未提供令牌。（空串显式回落，不能用 ?? —— ?? 不处理空串） */
    const typedKey = usageTest.apiKey.trim();
    const out = await c.testModelUsage({
      kind: usageTest.kind,
      name: usageTest.entry.name,
      baseUrl: usageTest.baseUrl.trim(),
      path: usageTest.path.trim(),
      apiKey: typedKey === "" ? (usageTest.entry.apiKey ?? undefined) : typedKey,
      prompt: usageTest.prompt,
      size: usageTest.size.trim() || undefined,
      /* 由结构化字段行生成请求体 JSON（替代原先手填整段 JSON）；
       * 视频且 mode=text 时媒体字段已被界面隐藏，这里同样排除，避免 invalid mode */
      extraJson: usageFieldsToJson(editor.usageFieldsToSend(usageTest)) || undefined,
    });
    setUsageTest((prev) =>
      prev ? { ...prev, running: false, querying: false, result: out } : prev,
    );
  }

  /** 对已提交但仍在生成的异步视频任务「继续等待」一轮（同一条目连接参数 +
   *  上次返回的 taskId）。只查既有任务，不重新提交、不重复扣费。 */
  async function continueUsageWait() {
    if (!usageTest || usageTest.querying) {
      return;
    }
    const taskId = usageTest.result?.taskId;
    if (taskId === undefined || taskId === "") {
      return;
    }
    setUsageTest({ ...usageTest, querying: true });
    const typedKey = usageTest.apiKey.trim();
    const out = await c.queryUsageTask({
      name: usageTest.entry.name,
      baseUrl: usageTest.baseUrl.trim(),
      path: usageTest.path.trim(),
      apiKey: typedKey === "" ? (usageTest.entry.apiKey ?? undefined) : typedKey,
      taskId,
    });
    setUsageTest((prev) => (prev ? { ...prev, querying: false, result: out } : prev));
  }

  return {
    usageTest,
    openUsageTest,
    closeUsageTest,
    patchUsageTest,
    runUsageTest,
    continueUsageWait,
    ...editor,
  };
}
