/**
 * 回归护栏：`repository-base.ts` 保持「纯机械 CRUD 基类」（ISSUE #565）。
 *
 * 背景：基类曾有一行 `log.debug("create", { id })`。它不是「日志实践」，而是
 * 把**日志口径钉在基类**上 —— 每个子类想记点有信息量的东西时，只能自己再加一条；
 * 同时让这一个模块在**没有日志设施**的宿主（测试、纯 Node 脚本）里也必须连带
 * 加载日志实现（pino + 脱敏 + 写盘镜像）。
 *
 * 本用例把「基类只做机械翻译」机器化，两条判据：
 *
 *   1. **不引日志**：基类不许 import `./logger` / `pino` / `app-runtime-log`。
 *      需要留痕的写入由**子类**按自己的语义记（如任务状态机在
 *      `repository-task.ts` 记状态迁移——那才是有信息量的那一行）。
 *   2. **不引上层**：基类只依赖 `db` 与表/列对象。仓储是数据层，反向引
 *      `server/**` / `components/**` 会让「谁在最底层」成环（规范 §18.2）。
 *
 * 为什么用「扫源码」而不是「断言行为」：这两条都是**依赖形状**约束，行为断言
 * 证明不了（日志加回去时行为一模一样，测试全绿——这正是它当初能长回来的原因）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BASE = join(ROOT, "src", "lib", "core", "repository-base.ts");

/** 去掉块注释与整行 `//` 注释，避免把说明性 import 当成真实依赖。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** 模块说明符提取（含动态 import）。 */
function specifiers(src: string): string[] {
  return [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((s): s is string => typeof s === "string");
}

describe("repository-base 是纯机械 CRUD 基类（ISSUE #565）", () => {
  const code = stripComments(readFileSync(BASE, "utf8"));

  it("基类不引日志（留痕归子类按语义记）", () => {
    const logImports = specifiers(code).filter((s) =>
      /(^|\/)(logger|app-runtime-log)$|^pino$/.test(s.replace(/^[@~]\//, "")),
    );
    expect(
      logImports,
      "基类只做「实体 ↔ 表 ↔ 主键」的机械翻译，不做日志。\n" +
        "在基类打点会把口径钉死在这里（子类只能另加一条），并让没有日志设施的宿主\n" +
        "（测试 / 纯 Node 脚本）连带加载 pino 与写盘镜像。需要留痕的写入由子类自己记。",
    ).toEqual([]);
    // 反向：说明里写清了「为什么删」——防止下一个人凭直觉加回来
    expect(readFileSync(BASE, "utf8")).toContain("基类");
  });

  it("基类不引上层（数据层只依赖 db 与表/列对象）", () => {
    const upward = specifiers(code).filter(
      (s) => s.startsWith("~/server/") || s.startsWith("@/server/"),
    );
    // 唯一允许的 `~/server/` 依赖是表**类型**定义（schema 是数据层的同层成员）
    const offenders = upward.filter(
      (s) => !/^[~@]\/server\/db\/schema$/.test(s),
    );
    expect(
      offenders,
      "仓储是数据层，反向依赖 server/** 会让「谁在最底层」成环（规范 §18.2）。\n" +
        "取 Drizzle 表定义（`~/server/db/schema`）属同层引用，允许。",
    ).toEqual([]);
    expect(specifiers(code)).toContain("~/server/db/schema");
  });

  it("扫描器有效：能识别真实依赖边与注释里的假边（反向验证）", () => {
    // 正向：真实 import 必须被认出来
    expect(specifiers(code)).toContain("drizzle-orm");
    expect(specifiers(code)).toContain("./errors");
    // 反向：注释里提到 `./logger`（说明为什么删）不得被算成依赖
    expect(readFileSync(BASE, "utf8")).toContain("./errors");
    expect(specifiers(code)).not.toContain("./logger");
  });
});
