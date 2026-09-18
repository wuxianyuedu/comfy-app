/**
 * 画布节点类型的**类型安全契约**（ISSUE #320）。
 *
 * 背景：`CanvasNodeData` 此前带一个裸索引签名 `[key: string]: unknown`，于是
 * 「字段名拼错」在 tsc 阶段**静默通过**——`d.promt` 被解析成 `unknown`，
 * 一层看起来存在的类型保险其实是假的（真正的炸点被推到运行时）。画布链路
 * 的 14 个文件都靠着它蒙混。
 *
 * 现在拆成两层：
 *   - `StrictCanvasNodeData`：业务代码用它，字段名/类型写错立刻报错；
 *   - `CanvasNodeData` 则等于「严格类型 & Record<string, unknown>」：
 *     只在交给 ReactFlow 的类型参数位置使用（它的 `Node<T>` 要求
 *     `T extends Record<string, unknown>`，即带索引签名）。
 *
 * 本文件用 `@ts-expect-error` 把「拼错必须报错」钉死：如果有人把索引签名
 * 挪回严格声明里，下面的 `@ts-expect-error` 会因为「没有错误可抑制」而
 * **自身报错**——反而让问题暴露，这正是我们要的护栏方向。
 */
import { describe, expect, it } from "vitest";

import {
  asCanvasNodeData,
  defaultData,
  type StrictCanvasNodeData,
} from "./canvas-types";

describe("StrictCanvasNodeData — 字段名拼错必须编译不过", () => {
  it("已声明字段可正常读写", () => {
    const d = defaultData("image");
    expect(d.prompt).toBeDefined();
    expect(d.kind).toBe("image");
    // 类型层面：这些访问都通过严格声明
    expect(typeof d.steps).toBe("number");
  });

  it("拼错字段名会被 tsc 拦住（下面每行都是一道护栏）", () => {
    const d: StrictCanvasNodeData = defaultData("image");

    // @ts-expect-error prompt 拼成 promt 必须报错（索引签名已不在严格声明里）
    void d.promt;
    // @ts-expect-error steps 拼成 stepz 必须报错
    void d.stepz;
    // @ts-expect-error kind 拼成 knd 必须报错
    void d.knd;
    // @ts-expect-error 完全不存在字段必须报错
    void d.thisFieldDoesNotExist;

    expect(true).toBe(true);
  });

  it("字段类型写错也会被拦住", () => {
    const d: StrictCanvasNodeData = defaultData("image");
    // @ts-expect-error status 只能是四个字面量之一
    d.status = "succeeded";
    // @ts-expect-error kind 只能是 NodeKind 之一
    d.kind = "not-a-kind";
    // @ts-expect-error steps 是 number，不能塞字符串
    d.steps = "twenty-five";

    expect(true).toBe(true);
  });
});

describe("asCanvasNodeData — 唯一的数据收口点", () => {
  it("把 ReactFlow 的宽 data 收窄成严格声明（单点断言）", () => {
    const raw: unknown = {
      kind: "image",
      status: "idle",
      prompt: "一只猫",
      steps: 25,
    };
    const d = asCanvasNodeData(raw);
    expect(d.prompt).toBe("一只猫");
    expect(d.steps).toBe(25);
  });

  it("收窄后返回的是严格类型：下游访问受检查（编译期契约）", () => {
    const raw: unknown = {};
    const d = asCanvasNodeData(raw);
    // @ts-expect-error 收窄后拼错字段名同样报错——这是收口的意义
    void d.promt;
    expect(d).toBeDefined();
  });
});

describe("defaultData — 各 kind 的必要字段齐备", () => {
  it("每种 kind 都产出可直接渲染的数据（不含 undefined 必填字段）", () => {
    for (const kind of [
      "image",
      "video",
      "text",
      "script",
      "agent",
      "workflow",
    ] as const) {
      const d = defaultData(kind);
      expect(d.kind).toBe(kind);
      expect(d.status).toBe("idle");
      expect(typeof d.prompt).toBe("string");
      expect(typeof d.steps).toBe("number");
      expect(Array.isArray(d.agentHistory)).toBe(true);
    }
  });
});
