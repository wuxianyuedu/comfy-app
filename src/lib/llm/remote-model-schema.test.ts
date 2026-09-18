/**
 * 「远端模型表单」字段规则（规范 16 §16.2.4.8）。
 *
 * 这份用例钉的是**规则归谁持有**这件事：字段级规则必须是 lib 里的纯函数
 * （不碰 React、不碰列表），这样它既能被 controller 复用，也能在这里穷举。
 */
import { describe, expect, it } from "vitest";

import {
  remoteModelFieldSchema,
  validateRemoteModelFields,
} from "./remote-model-schema";

describe("validateRemoteModelFields", () => {
  it("名称为空 → 报「请填写模型名称」，挂在 model 字段上", () => {
    expect(validateRemoteModelFields({ model: "" })).toEqual({
      model: "请填写模型名称",
    });
  });

  it("纯空白名称同样不算填了（trim 后判定）", () => {
    expect(validateRemoteModelFields({ model: "   " })).toEqual({
      model: "请填写模型名称",
    });
  });

  it("只校验名称：接口地址与密钥可留空（回落全局配置）", () => {
    expect(
      validateRemoteModelFields({ model: "gpt-4o", baseUrl: "", apiKey: "" }),
    ).toEqual({});
  });

  it("通过时返回空对象（视图据此决定不渲染任何行内错误）", () => {
    expect(
      validateRemoteModelFields({
        model: "openai/gpt-4o",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-x",
      }),
    ).toEqual({});
  });

  it("字段缺失走同一条规则，不会因 undefined 抛错", () => {
    expect(validateRemoteModelFields({}).model).toBe("请填写模型名称");
  });
});

describe("remoteModelFieldSchema", () => {
  it("kind 缺省回落 chat —— 与「未选用途 = 对话」的既有行为一致", () => {
    expect(remoteModelFieldSchema.parse({ model: "m" }).kind).toBe("chat");
  });

  it("kind 只接受三种用途，其它值判不通过", () => {
    expect(
      remoteModelFieldSchema.safeParse({ model: "m", kind: "audio" }).success,
    ).toBe(false);
  });

  it("模型名不做额外格式限制（OpenAI 兼容侧的名字形态很杂）", () => {
    for (const name of ["gpt-4o", "openai/gpt-4o", "qwen3:14b", "a b c"]) {
      expect(validateRemoteModelFields({ model: name })).toEqual({});
    }
  });
});
