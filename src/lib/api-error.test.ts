/**
 * 「服务端错误信封」的唯一口径（规范 16 §16.2.4.35）。
 *
 * 用例钉的是收口前**六个客户端各判各的**那几件事：字符串 `error`、
 * 结构化 `{error:{message}}`、非法 JSON、空文案、以及「不是错误体」。
 */
import { describe, expect, it } from "vitest";

import {
  RESPONSE_ERROR_KEY,
  apiErrorBody,
  apiErrorDetail,
  readApiError,
  readJsonBody,
} from "./api-error";

describe("apiErrorDetail", () => {
  it("未知抛值回落这一路动作的标题（不是通用兜底）", () => {
    expect(apiErrorDetail(null, "读取素材库失败")).toBe("读取素材库失败");
  });

  it("Error 的 message 优先于标题", () => {
    expect(apiErrorDetail(new Error("db down"), "读取失败")).toBe("db down");
  });

  it('空 message 回落标题（`new Error("")` 不该渲染成空白提示）', () => {
    expect(apiErrorDetail(new Error(""), "保存失败")).toBe("保存失败");
  });

  it("网络层原文翻成人话（与 UI 侧同一枚口径）", () => {
    const e = new Error("Failed to fetch");
    expect(apiErrorDetail(e, "上传失败")).toContain("网络请求失败");
  });
});

describe("apiErrorBody", () => {
  it("错误文案挂在唯一的键上", () => {
    expect(apiErrorBody(new Error("boom"), "保存失败")).toEqual({
      error: "boom",
    });
  });

  it("业务字段原样展开（带字段的失败体不必各拼一遍）", () => {
    expect(
      apiErrorBody(new Error("boom"), "读取素材库失败", {
        folders: [],
        items: [],
      }),
    ).toEqual({ folders: [], items: [], error: "boom" });
  });

  it("业务字段不会顶掉 error 键", () => {
    const body = apiErrorBody(new Error("boom"), "失败", {
      [RESPONSE_ERROR_KEY]: "不该出现",
    });
    expect(body.error).toBe("boom");
  });
});

describe("readApiError", () => {
  it("认字符串 error（REST 路由的常规形态）", () => {
    expect(readApiError({ error: "读取素材库失败" })).toBe("读取素材库失败");
  });

  it("认结构化信封 {error:{message}}（errorResponse 下发的那一种）", () => {
    expect(
      readApiError({ error: { code: "not_found", message: "不存在" } }),
    ).toBe("不存在");
  });

  it("空字符串 / 空白的 message 不算错误文案", () => {
    expect(readApiError({ error: "" })).toBeNull();
    expect(readApiError({ error: { message: "  " } })).toBeNull();
  });

  it("不是错误体时给 null（交给调用处的 fallback）", () => {
    expect(readApiError({ folders: [], items: [] })).toBeNull();
    expect(readApiError(null)).toBeNull();
    expect(readApiError("字符串体")).toBeNull();
    expect(readApiError({ error: 42 })).toBeNull();
  });
});

describe("readJsonBody", () => {
  it("非法 JSON 按空对象处理（后端 500 可能返回非 JSON）", async () => {
    const res = new Response("<!DOCTYPE html>", { status: 500 });
    await expect(readJsonBody(res)).resolves.toEqual({});
  });

  it("合法 JSON 原样返回", async () => {
    const res = new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
    });
    await expect(readJsonBody(res)).resolves.toEqual({ error: "boom" });
  });
});
