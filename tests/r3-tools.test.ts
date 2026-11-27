/**
 * 第三轮工具化的纯函数契约（ISSUE #5191 / #5192）。
 */
import { describe, expect, it } from "vitest";

import { assetLinkOf, screenshotBody } from "../scripts/ship/ship-screenshot-reply.mjs";
import { parseArgs } from "../scripts/ship/ship-args.mjs";

describe("ship --screenshot-reply", () => {
  it("从上传应答取 asset_link（两种平台形状都收）", () => {
    expect(assetLinkOf({ status: 200, data: { asset_link: "https://x/a.png" } })).toBe(
      "https://x/a.png",
    );
    expect(assetLinkOf({ asset_link: "https://x/b.png" })).toBe("https://x/b.png");
    expect(assetLinkOf({ status: 200, data: {} })).toBeNull();
  });
  it("正文带署名首行且不重复署名", () => {
    const text = screenshotBody({ body: "改了按钮\n", link: "https://x/a.png", handle: "d-win" });
    expect(text.startsWith("**[评论人：d-win]**")).toBe(true);
    expect(text.match(/评论人/g)).toHaveLength(1);
    expect(text).toContain("改后截图：https://x/a.png");
  });
  it("旗标解析：号 + 截图文件 + 可选文案", () => {
    const opt = parseArgs([
      "--screenshot-reply",
      "5191",
      "--file",
      "log/screenshots/a.png",
      "--body-file",
      "note.md",
    ]);
    expect(opt.screenshotReply).toBe(5191);
    expect(opt.screenshotFile).toBe("log/screenshots/a.png");
    expect(opt.bodyFile).toBe("note.md");
  });
});
