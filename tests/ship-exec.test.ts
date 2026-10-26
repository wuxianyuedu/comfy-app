/**
 * `ship-exec.mjs` 的取数形状 —— 这里只钉 `buildSnFromOutput()`（ISSUE #2378）。
 *
 * 「写动作成没成」只认回读到的对象：start-build 真起了一跑时输出里必有一个 `sn`，
 * 而 403 / scope 不足那一族 cnb **照旧退 0** —— 消费方若只看退出码，那条红就静默了。
 * 这组用例钉住「什么形状读得回 sn」，委托口与探针口都靠它。
 */
import { describe, expect, it } from "vitest";

import { buildSnFromOutput } from "../scripts/ship-exec.mjs";

describe("buildSnFromOutput：start-build 的 sn 回读", () => {
  it("三种在场形状都读得回（无 -v 的紧凑输出 / JSON / key=value）", () => {
    expect(buildSnFromOutput('sn: "cnb-abc-1k5xyz"')).toBe("cnb-abc-1k5xyz");
    expect(buildSnFromOutput('{"sn":"cnb-abc-1k5xyz"}')).toBe("cnb-abc-1k5xyz");
    expect(buildSnFromOutput("sn=cnb-abc-1k5xyz")).toBe("cnb-abc-1k5xyz");
  });

  it("错误信封里没有 sn ⇒ null（403 / scope 不足那一族，退 0 也不许当「发出去了」）", () => {
    expect(
      buildSnFromOutput(
        '{"status":403,"data":{"errcode":10023,"errmsg":"..."}}',
      ),
    ).toBeNull();
    expect(
      buildSnFromOutput("The token's authorization scope does not match"),
    ).toBeNull();
    expect(buildSnFromOutput("")).toBeNull();
    expect(buildSnFromOutput(undefined as unknown as string)).toBeNull();
  });

  it("sn 不在场时，别处出现的 cnb 字样不带偏（只认 sn 键的取值）", () => {
    /* 日志里有仓库名、链接等 cnb 字样，但没有 sn 键 ⇒ null。 */
    expect(
      buildSnFromOutput("repo: moon-read/comfy-app-t3 at https://cnb.cool/..."),
    ).toBeNull();
  });
});
