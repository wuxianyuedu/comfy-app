import { describe, it, expect } from "vitest";

import {
  ERROR_AUTO_EXPAND_RE,
  GENERIC_ERROR_ADVICE,
  adviseOnError,
  adviseWithFallback,
  shouldAutoExpandError,
} from "./error-advice";

describe("adviseOnError", () => {
  it("显存不足：两处旧词表各自给一句，收口后只有一句", () => {
    /* 收口前历史卡说「降低 batch size / 分辨率」、画布面板说「拆成更小的
     * 批次 / 关闭其他任务」—— 同一句报错在两处给出不同建议。 */
    const advice = adviseOnError(
      "CUDA out of memory. Tried to allocate 2.00 GiB",
    );
    expect(advice).toBeTruthy();
    expect(advice).toContain("批次");
  });

  it("模型缺失：连 ckpt 的短写法也认（旧词表互相漏项之一）", () => {
    expect(adviseOnError("ckpt not found")).toContain("models/checkpoints");
    expect(adviseOnError("Cannot find model: a.safetensors")).toContain(
      "models/checkpoints",
    );
  });

  it("comfy-cli 解释器缺失：建议指向设置页，而不是让用户建 venv（ISSUE #1239）", () => {
    // 报错原文带着 Windows 绝对路径，规则必须排在通用「模型缺失 / not found」之前，
    // 否则会被按子串误抢成一句与成因无关的建议。
    const advice = adviseOnError(
      "未找到 comfy-cli Python 解释器：D:\\apps\\ComfyAPP\\static\\python-venv\\comfy-cli\\Scripts\\python.exe",
    );
    expect(advice).toContain("设置");
    expect(advice).toContain("comfy-cli 解释器");
    // 桌包用户没有 pnpm 也没有检出：这条建议里不许出现开发者命令
    expect(advice).not.toContain("pip install");
    expect(adviseOnError("COMFY_CLI_PYTHON not set")).toContain("comfy-cli");
  });

  it("连接失败：超时 / 拒绝连接 / 网络三种写法同一句建议", () => {
    const a = adviseOnError("ECONNREFUSED 127.0.0.1:8188");
    const b = adviseOnError("request timed out");
    const c = adviseOnError("TypeError: fetch failed");
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("队列满 / 服务忙：旧词表只有一半认得（画布侧没有 `queue`）", () => {
    expect(adviseOnError("queue full")).toContain("队列");
    expect(adviseOnError("server_busy")).toContain("队列");
    expect(adviseOnError("HTTP 503")).toBeTruthy();
  });

  it("参数类型错误：ValueError / KeyError / 类型不匹配同一句", () => {
    const a = adviseOnError("ValueError: bad input");
    expect(a).toBe(a);
    expect(adviseOnError("KeyError: 'cfg'")).toBeTruthy();
    expect(adviseOnError("Input type mismatch at node 3")).toBeTruthy();
  });

  it("wrapper 子图缺失优先于「模型缺失」判定（规则顺序即优先级）", () => {
    const text =
      "Node 7 not found: 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d not installed";
    const advice = adviseOnError(text);
    expect(advice).toContain("wrapper 子图");
    expect(advice).toContain("1a2b3c4d");
  });

  it("UUID 命中但报错不是「找不到」时，回落到其它规则或 null", () => {
    /* UUID 规则自己返回空串 —— 判据是「UUID 且 not found/installed」。 */
    const advice = adviseOnError(
      "Traceback 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    );
    expect(advice).toBeNull();
  });

  it("提示词为空 / 非法：`null` 与 `undefined` 字面量也认", () => {
    /* 这一条同时是那条「词表互相漏项」的实例：收口前只有历史卡认得
     * `prompt|empty|null|undefined`，画布面板没有这一支。 */
    expect(adviseOnError("prompt is empty")).toContain("提示词");
    expect(adviseOnError("got undefined")).toContain("提示词");
  });

  it("UUID 命中且确实「找不到」时才给建议（另一支：UUID + not installed）", () => {
    const advice = adviseOnError(
      "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d not installed",
    );
    expect(advice).toContain("wrapper 子图");
  });

  it("未识别形态给 null（不编造建议）", () => {
    expect(adviseOnError("something weird happened")).toBeNull();
  });

  it("空值给 null（没报错就没有建议）", () => {
    expect(adviseOnError(null)).toBeNull();
    expect(adviseOnError(undefined)).toBeNull();
    expect(adviseOnError("")).toBeNull();
  });

  it("建议里不带「建议：」前缀（那是渲染层的事）", () => {
    expect(adviseOnError("out of memory")).not.toContain("建议：");
  });
});

describe("adviseWithFallback", () => {
  it("未识别时回落通用兜底（卡片上那一行位置固定，不能缺）", () => {
    expect(adviseWithFallback("something weird")).toBe(GENERIC_ERROR_ADVICE);
  });

  it("识别到就走规则表（不重复兜底）", () => {
    expect(adviseWithFallback("out of memory")).not.toBe(GENERIC_ERROR_ADVICE);
  });

  it("没报错时也给兜底", () => {
    expect(adviseWithFallback(null)).toBe(GENERIC_ERROR_ADVICE);
  });
});

describe("shouldAutoExpandError", () => {
  it("有结构化校验错误就展开（不必看报错文案）", () => {
    expect(shouldAutoExpandError(null, 2)).toBe(true);
  });

  it("命中「可行动」形态展开", () => {
    expect(shouldAutoExpandError("Node 3 not installed")).toBe(true);
    expect(ERROR_AUTO_EXPAND_RE.test("insufficient memory")).toBe(true);
  });

  it("普通报错不展开（不打断用户）", () => {
    expect(shouldAutoExpandError("something weird")).toBe(false);
  });

  it("没报错不展开", () => {
    expect(shouldAutoExpandError(null)).toBe(false);
    expect(shouldAutoExpandError(undefined, 0)).toBe(false);
  });
});
