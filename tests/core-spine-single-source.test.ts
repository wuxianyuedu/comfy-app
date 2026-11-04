/**
 * 回归护栏：core 骨架的三处「唯一事实源」（ISSUE #568）：日志单通道（`lib/core/logger.ts`，`single-logger-channel` 判）、
 * 仓储单取法（容器已移除，`container-single-access` 判）、配置不再假装集中——`lib/core/config.ts` 只承诺「类型契约 +
 * 默认值」，注释里不许写「任何模块都应从这里读」：直读 `process.env` 有 30+ 处（schema 只覆盖 7 个变量），下一个人会照抄。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CONFIG = join(ROOT, "src", "lib", "core", "config.ts");

describe("core 骨架的单一事实源（ISSUE #568）", () => {
  it("config.ts 不再承诺「任何模块都应从这里读」", () => {
    const src = readFileSync(CONFIG, "utf8");
    // 判据落在「模块文档里的**承诺句式**」上：正文里回顾历史时引用旧句子是允许的，
    // 但不许再出现「任何模块都应 … 而不是再直接读 process.env」这种现在时的承诺。
    expect(src).not.toMatch(/任何模块都应[^\n]*而不是/);
    // 裁决本身要写在文件里：下一个人得知道「为什么这里是契约而不是收口」
    expect(src).toContain("不承诺");
    expect(src).toContain("CONFIG_ENV_DEFAULTS");
  });

  it("可直接读到的默认值与 schema 默认值同源（不是各写一遍）", () => {
    const src = readFileSync(CONFIG, "utf8");
    // schema 的两个「本机端口/地址」默认值必须引用共享常量
    expect(src).toMatch(/default\(CONFIG_ENV_DEFAULTS\.port\)/);
    expect(src).toMatch(/default\(CONFIG_ENV_DEFAULTS\.comfyuiBaseUrl\)/);
  });

  it("本机端点常量层没有被绕过（config 的默认值取自它）", () => {
    // 这条是反向验证：`COMFYUI_BASE_URL` 的 schema 默认值必须来自 endpoints.ts，
    // 而不是在 config.ts 里再写一遍 `http://127.0.0.1:8188`。
    const src = readFileSync(CONFIG, "utf8");
    expect(src).toContain("comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)");
    expect(src).not.toMatch(/http:\/\/127\.0\.0\.1:8188/);
  });
});
