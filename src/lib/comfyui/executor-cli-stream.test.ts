// comfy-cli 流解析与 envelope 收口的测试（ISSUE #570 第 5 项）。
//
// 这些逻辑此前是 `executeViaComfyCli` 里三段内联回调（约 240 行）：
// stdout 的按行聚合、stderr 的噪声过滤、envelope 收口。它们捕获 promptId /
// patched / settled，要验证「非 JSON 行的上限」「envelope 里深搜 node_errors」
// 都得起真 Python 进程。抽成注入式函数后逐条可断言。

import { describe, expect, it, vi } from "vitest";

import {
  createCliEnvelopeParser,
  createCliFinisher,
  createCliStderrSink,
  envelopeErrorMessage,
  findNodeErrorsCarrier,
  MAX_NON_JSON_LINES,
  translateWorkflowUnknownNodesError,
} from "./executor-cli-stream";

/** 静默 trace / log（默认实现会写盘或拖 DB，测试用自己的收集器）。 */
const noTrace = () => undefined;
const noLog = () => undefined;

describe("findNodeErrorsCarrier（深搜结构化校验错误）", () => {
  it("命中 error.details.node_errors 列表（comfy-cli 实际到达的形态）", () => {
    const env = { error: { details: { node_errors: [{ node_id: "3" }] } } };
    expect(findNodeErrorsCarrier(env)).toEqual([{ node_id: "3" }]);
  });

  it("命中 error.node_errors / 顶层 node_errors（防御性位置）", () => {
    expect(findNodeErrorsCarrier({ error: { node_errors: { a: 1 } } })).toEqual(
      { a: 1 },
    );
    expect(findNodeErrorsCarrier({ node_errors: { b: 2 } })).toEqual({ b: 2 });
  });

  it("空列表 / 空对象不算命中（避免把空信封当校验错误）", () => {
    expect(findNodeErrorsCarrier({ node_errors: [] })).toBeUndefined();
    expect(findNodeErrorsCarrier({ node_errors: {} })).toBeUndefined();
  });

  it("浅层找不到就放弃（不会无限递归循环引用）", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(findNodeErrorsCarrier(a)).toBeUndefined();
  });
});

describe("translateWorkflowUnknownNodesError（comfy-cli 校验错误翻中文）", () => {
  it("workflow_unknown_nodes + details.errors 翻成中文可操作提示", () => {
    const env = {
      error: {
        code: "workflow_unknown_nodes",
        message: "Workflow has 1 validation error(s) against server",
        details: {
          errors: [
            {
              node_id: "459:452",
              field: "images",
              code: "autogrow_no_slots",
              message:
                "required autogrow input 'images' has no connected slots",
              hint: "wire one key per connection: images.image_1, images.image_2",
            },
          ],
        },
      },
    };
    const out = translateWorkflowUnknownNodesError(env);
    expect(out).toContain("工作流校验未通过");
    expect(out).toContain("节点 459:452");
    expect(out).toContain("images");
    expect(out).toContain("images.image_1、images.image_2");
  });

  it("非 workflow_unknown_nodes 返回 null（交给兜底逻辑）", () => {
    expect(
      translateWorkflowUnknownNodesError({
        error: { code: "prompt_rejected", message: "x" },
      }),
    ).toBeNull();
    expect(translateWorkflowUnknownNodesError(undefined)).toBeNull();
  });
});

describe("envelopeErrorMessage（message → hint → 兜底）", () => {
  it("优先 message，其次 hint，都没有给兜底文案", () => {
    expect(envelopeErrorMessage({ error: { message: "M" } })).toBe("M");
    expect(envelopeErrorMessage({ error: { hint: "H" } })).toBe("H");
    expect(envelopeErrorMessage({})).toBe("comfy-cli 执行失败");
  });
});

describe("createCliEnvelopeParser（按行聚合 + 事件分发）", () => {
  const mk = (
    over: Partial<Parameters<typeof createCliEnvelopeParser>[0]> = {},
  ) => {
    const onPromptId = vi.fn();
    const onProgress = vi.fn();
    const finish = vi.fn();
    const p = createCliEnvelopeParser({
      taskId: "t1",
      log: noLog,
      finish,
      onPromptId,
      onProgress,
      trace: noTrace,
      ...over,
    });
    return { p, onPromptId, onProgress, finish };
  };

  it("跨 chunk 的半行被拼起来（buffer 累积）", () => {
    const { p, onPromptId } = mk();
    p.sink('{"type":"queued","prompt_');
    expect(onPromptId).not.toHaveBeenCalled();
    p.sink('id":"abc"}\n');
    expect(onPromptId).toHaveBeenCalledWith("abc");
  });

  it("多个事件在一行里逐行分发（不丢行）", () => {
    const { p, onPromptId, onProgress } = mk();
    p.sink(
      '{"type":"queued","prompt_id":"p1"}\n{"type":"progress","completed":1,"total":4}\n',
    );
    expect(onPromptId).toHaveBeenCalledWith("p1");
    // 事件不带 node：第二参为 undefined（3-C D1 的透传契约）
    expect(onProgress).toHaveBeenCalledWith(25, undefined);
  });

  it("progress 事件带 node 时透传当前节点步数（3-C D1：调用方落 progressNode）", () => {
    const { p, onProgress } = mk();
    p.sink('{"type":"progress","node":"76:69","completed":3,"total":25}\n');
    // 这一格没给 `patched` ⇒ 认不出类名，但 id 与步数照旧透出（进度不许因为
    // 类名缺失就丢帧）—— #1202 之前的常态就是这个形状。
    expect(onProgress).toHaveBeenCalledWith(12, {
      id: "76:69",
      value: 3,
      max: 25,
    });
  });

  it("给了 patched（提交那一刻的图）就把类名与中文标签一起透出（ISSUE #1202）", () => {
    // raw 任务的进度历史上全走 comfy-cli 这条路，所以状态栏「当前节点」能不能显示
    // 类名取决于这里，而不是 executor-ws 那一侧。子图 id（`76:69`）也要认得出。
    const { p, onProgress } = mk({
      patched: {
        nodes: [{ id: 76, type: "SUBGRAPH_ID", inputs: [] }],
        definitions: {
          subgraphs: [
            {
              id: "SUBGRAPH_ID",
              nodes: [{ id: 69, type: "KSampler", inputs: [] }],
            },
          ],
        },
      },
    });
    p.sink('{"type":"progress","node":"76:69","completed":3,"total":25}\n');
    expect(onProgress).toHaveBeenCalledWith(12, {
      id: "76:69",
      value: 3,
      max: 25,
      classType: "KSampler",
      label: "采样去噪",
    });
  });

  it("`executing` 事件自带 class_type 时以事件为准（那是 ComfyUI 展开子图后的权威值）", () => {
    const lines: Array<[string, string, string]> = [];
    const { p } = mk({
      log: (taskId, level, msg) => {
        lines.push([taskId, level, msg]);
      },
      // 图里这一格故意给一个不同的类名：真出图实测 `executing` 带 class_type，
      // 事件那一份才是 ComfyUI 真正在跑的那个节点。
      patched: { nodes: [{ id: 76, type: "KSampler", inputs: [] }] },
    });

    p.sink(
      '{"schema": "event/1", "type": "executing", "node": "76:67", ' +
        '"title": "CLIP Text Encode (Positive Prompt)", "class_type": "CLIPTextEncode"}\n',
    );

    expect(
      lines.map((l) => l[2]).find((m) => m.includes("comfy-cli 节点")),
    ).toBe("▶ comfy-cli 节点 [76:67] 编码提示词（CLIPTextEncode） 开始执行");
  });

  it("`progress` 事件不带类名 ⇒ 按 `patched` 那张图认（与 WS 帧同一个出口）", () => {
    const { p, onProgress } = mk({
      patched: { nodes: [{ id: 76, type: "SUBGRAPH_ID", inputs: [] }] },
    });
    p.sink(
      '{"schema":"event/1","type":"progress","node":"76","completed":1,"total":25}\n',
    );

    expect(onProgress).toHaveBeenCalledWith(4, {
      id: "76",
      value: 1,
      max: 25,
      classType: "SUBGRAPH_ID",
      label: "SUBGRAPH_ID", // 表里没有的类名，nodeLabel 原样回类名（不编一个中文名）
    });
  });

  it("事件不带 class_type 时那两行退回按图认（开始与完成用同一个名字，别一边有一边没有）", () => {
    const lines: Array<[string, string, string]> = [];
    const { p } = mk({
      log: (taskId, level, msg) => {
        lines.push([taskId, level, msg]);
      },
      patched: { nodes: [{ id: 3, type: "LoraLoader", inputs: [] }] },
    });

    p.sink('{"type":"executing","node":"3"}\n');
    p.sink('{"type":"execution_success","node":"3"}\n');

    // 只看这两行本身（parser 还会为每条原始行打一行「[comfy-cli 原始] …」）。
    expect(
      lines.map((l) => l[2]).filter((m) => m.includes("comfy-cli 节点")),
    ).toEqual([
      "▶ comfy-cli 节点 [3] 加载 LoRA（LoraLoader） 开始执行",
      "✓ comfy-cli 节点 [3] 加载 LoRA（LoraLoader） 执行完成",
    ]);
  });

  it("envelope 事件触发收口，ok 原样透给 finish", () => {
    const { p, finish } = mk();
    p.sink('{"type":"envelope","ok":false,"error":{"message":"x"}}\n');
    expect(finish).toHaveBeenCalledWith(false, {
      type: "envelope",
      ok: false,
      error: { message: "x" },
    });
  });

  it("非 JSON 行不抛错，也不触发任何分发", () => {
    const { p, onPromptId, finish } = mk();
    expect(() => p.sink("Traceback (most recent call last):\n")).not.toThrow();
    expect(onPromptId).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("非 JSON 行超过上限后不再逐行进面板（只留一行省略提示）", () => {
    const { p } = mk();
    // 灌入上限 + 1 行非 JSON；断言不抛错即可（面板行数由 log 内部处理）
    for (let i = 0; i < MAX_NON_JSON_LINES + 2; i++) p.sink(`noise-${i}\n`);
    expect(p.leftover()).toBe("");
  });

  it("leftover 返回未成行的尾部（进程退出时落 trace 用）", () => {
    const { p } = mk();
    p.sink('{"type":"queued","prompt_id":"p1"}\nPARTIAL');
    expect(p.leftover()).toBe("PARTIAL");
  });
});

describe("createCliStderrSink（噪声过滤 + 限行 + 完整留底）", () => {
  it("过滤 DeprecationWarning 噪声并计数，不占行数上限", () => {
    const s = createCliStderrSink({ taskId: "t1", log: noLog, trace: noTrace });
    s.sink("DeprecationWarning: blah\nreal error line\n");
    expect(s.noisyWarningLines()).toBe(1);
    expect(s.raw()).toContain("real error line");
  });

  it("raw 始终完整累积（不受 60 行上限影响）", () => {
    const s = createCliStderrSink({ taskId: "t1", log: noLog, trace: noTrace });
    for (let i = 0; i < 100; i++) s.sink(`line-${i}\n`);
    expect(s.raw().split("\n").filter(Boolean)).toHaveLength(100);
  });
});

describe("createCliFinisher（完成 / 失败收口）", () => {
  const mk = (settle: () => boolean) => {
    const complete = vi.fn();
    const fail = vi.fn();
    const f = createCliFinisher({
      taskId: "t1",
      log: noLog,
      settle,
      promptId: () => "p1",
      complete,
      fail,
    });
    return { f, complete, fail };
  };

  it("成功：调 complete 并带上 promptId", () => {
    const { f, complete, fail } = mk(() => true);
    f(true, { type: "envelope", ok: true });
    expect(complete).toHaveBeenCalledWith("t1", "p1");
    expect(fail).not.toHaveBeenCalled();
  });

  it("失败：调 fail 并把结构化校验错误作为第 4 参", () => {
    const { f, complete, fail } = mk(() => true);
    f(false, {
      type: "envelope",
      ok: false,
      error: {
        message: "bad",
        details: { node_errors: [{ node_id: "3", errors: [] }] },
      },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalled();
    expect(fail.mock.calls[0]?.[0]).toBe("t1");
    expect(fail.mock.calls[0]?.[2]).toBe("bad");
  });

  it("幂等：settle 返回 false 时直接返回，不重复收口", () => {
    let n = 0;
    const { f, complete } = mk(() => {
      n++;
      return n === 1;
    });
    f(true, { type: "envelope", ok: true });
    f(true, { type: "envelope", ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
