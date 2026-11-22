import { describe, expect, it } from "vitest";

import { rejectCrossOriginWrite } from "./same-origin";

const ENDPOINT = "http://127.0.0.1:3100/api/materials";

function requestWithOrigin(origin?: string): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: origin === undefined ? {} : { origin },
  });
}

describe("rejectCrossOriginWrite（#4723 写端点同源闸）", () => {
  it("缺 Origin（本机工具 / curl）放行", () => {
    expect(rejectCrossOriginWrite(requestWithOrigin())).toBeNull();
  });

  it("本机界面同源 Origin 放行", () => {
    expect(rejectCrossOriginWrite(requestWithOrigin("http://127.0.0.1:3100"))).toBeNull();
  });

  it("启动页那一族 Origin（tauri 壳）放行", () => {
    expect(rejectCrossOriginWrite(requestWithOrigin("http://tauri.localhost"))).toBeNull();
    expect(rejectCrossOriginWrite(requestWithOrigin("tauri://localhost"))).toBeNull();
  });

  it("跨站 Origin → 403（响应不可读也要挡住写副作用）", () => {
    const res = rejectCrossOriginWrite(requestWithOrigin("https://evil.example"));
    expect(res?.status).toBe(403);
  });

  it("带查询串的 DELETE 同样按 Origin 判（简单请求不经 preflight）", () => {
    const req = new Request(`${ENDPOINT}?id=scope/folder/name`, {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });
    expect(rejectCrossOriginWrite(req)?.status).toBe(403);
  });
});
