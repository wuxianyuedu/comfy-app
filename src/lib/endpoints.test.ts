import { describe, expect, it } from "vitest";

import {
  comfyUiBaseUrl,
  LOOPBACK_HOST,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_PORT,
} from "./endpoints";

/* 这一组用例锁的是「默认地址只有一处定义」这个契约本身（ISSUE #536 P3）。
 * 历史上的问题是同一个地址在 5 个文件里各写一遍 —— 改默认端口要改多处，
 * 漏一处的表现是**静默的行为分叉**（设置页显示 11434、实际请求打到别的默认
 * 值上）。这里把拼装口径钉死，避免有人再「顺手写一个字符串」。 */
describe("本机服务端点常量（规范 §12.14）", () => {
  it("回环地址用 IPv4 显式写法，不用 localhost", () => {
    // Node 的 fetch 会把 localhost 先解析成 ::1，而 ComfyUI / Ollama 默认只
    // 监听 IPv4 —— 表现为「curl 通、程序连不上」这类难查的 ECONNREFUSED。
    expect(LOOPBACK_HOST).toBe("127.0.0.1");
    expect(OLLAMA_DEFAULT_BASE_URL).not.toContain("localhost");
    expect(comfyUiBaseUrl(8188)).not.toContain("localhost");
  });

  it("Ollama 默认 Base URL 由端口常量拼出（改端口只需改一处）", () => {
    expect(OLLAMA_DEFAULT_BASE_URL).toBe(
      `http://${LOOPBACK_HOST}:${OLLAMA_DEFAULT_PORT}/v1`,
    );
  });

  it("comfyUiBaseUrl 按传入端口拼地址，不内嵌默认端口", () => {
    expect(comfyUiBaseUrl(8188)).toBe("http://127.0.0.1:8188");
    expect(comfyUiBaseUrl(9100)).toBe("http://127.0.0.1:9100");
  });
});
