/**
 * `{ syntax: "hash" }` 那一档的验收（ISSUE #2934）：`scripts/dev-launcher.ps1`（PowerShell）与
 * `src-tauri/Cargo.toml`（TOML）用 `#` 开注释；此前只有 JS 档，拿它去剥等于没剥（实测 2898 → 2898）。
 * 于是注释里的旧调用照样红（口径只在文档成立）。钉三件：`#` 整行剥且行数不漂；引号内 `#` 是代码；剥完真实调用判红、注释提及不判红。
 */
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

describe("stripComments · syntax: hash（ISSUE #2934）", () => {
  it("整行 # 注释被剥掉，行数不漂", () => {
    const src = ["# 入口说明", "$x = 1", "   # 缩进的注释", "$y = 2", ""].join("\n");
    const out = stripComments(src, { syntax: "hash" });
    expect(out.split("\n")).toHaveLength(5);
    expect(out).not.toContain("入口说明");
    expect(out).not.toContain("缩进的注释");
    expect(out).toContain("$x = 1");
    expect(out).toContain("$y = 2");
  });

  it("引号内的 # 是代码，原样留着", () => {
    const src = ['$a = "a#b"', "$b = 'c#d'", "# 真注释"].join("\n");
    const out = stripComments(src, { syntax: "hash" });
    expect(out).toContain('"a#b"');
    expect(out).toContain("'c#d'");
    expect(out).not.toContain("真注释");
  });

  it("hash 档没有块注释语法：斜杠星号的成对写法原样留着（只有 JS 档才吃它）", () => {
    const src = "/* 这不是注释 */\n$x = 1\n";
    expect(stripComments(src, { syntax: "hash" })).toBe(src);
  });

  it("默认保守只去整行注释；trailing: true 才连行尾一起去", () => {
    const src = "taskkill /IM x # 收尾说明\n";
    expect(stripComments(src, { syntax: "hash" })).toBe(src);
    expect(stripComments(src, { syntax: "hash", trailing: true })).toBe("taskkill /IM x \n");
  });

  it("真实调用判红、注释提及不判红（.ps1 格的口径）", () => {
    const forbidden = /taskkill\s+\//;
    const mention = "# 以前这里调过 taskkill /IM comfy.exe，现已改为进程组回收\n$x = 1\n";
    const real = "$y = 1\ntaskkill /IM comfy.exe /T\n";
    expect(stripComments(mention, { syntax: "hash", trailing: true })).not.toMatch(forbidden);
    expect(stripComments(real, { syntax: "hash", trailing: true })).toMatch(forbidden);
  });

  it("Cargo.toml 格保留行首锚语义：注释行剥空，真依赖行照样命中", () => {
    const src = [
      "# windows = \"0.61\" （历史：曾在非 Windows 下也参与编译）",
      "[dependencies]",
      "serde = \"1\"",
      "[target.'cfg(windows)'.dependencies]",
      "windows = \"0.61\"",
    ].join("\n");
    const cargo = stripComments(src, { syntax: "hash" });
    const [beforeTarget] = cargo.split("[target.'cfg(windows)'.dependencies]");
    /* 行首锚的含义没变：剥完的注释行是空行，不会被那根 `/^windows\\s*=/m` 误命中。 */
    expect(beforeTarget).not.toMatch(/^windows\s*=/m);
    expect(cargo).toContain("windows = \"0.61\"");
    /* 反向：真把依赖写到无条件区段，同一根锚当场判红。 */
    expect(`windows = "0.61"\n${beforeTarget}`).toMatch(/^windows\s*=/m);
  });

  it("JS 档不受影响：# 在 JS 里是代码，// 照旧剥", () => {
    expect(stripComments("a # b")).toBe("a # b");
    expect(stripComments("a // b", { trailing: true })).toBe("a ");
    /* 默认语法就是 js，显式写与不写必须一致。 */
    expect(stripComments("a // b", { syntax: "js", trailing: true })).toBe(
      stripComments("a // b", { trailing: true }),
    );
  });
});
