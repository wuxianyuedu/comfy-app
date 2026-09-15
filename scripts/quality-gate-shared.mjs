#!/usr/bin/env node
/**
 * quality-gate-shared.mjs — 质量门禁的**共享常量**（规范 11.12）
 *
 * 已知基线失败清单只有一处来源：先前它写在 `scripts/quality-gate.ps1` 里，
 * `scripts/run-tests.ps1` 用正则去解析那份 PowerShell 源码。两份实现（PowerShell
 * 与 Node）都要读同一份清单时，从 `.ps1` 源码里解析就等于把「另一门语言的文件」
 * 当成数据源 —— 改一次缩进/写法就会让解析静默返回空数组（排除项悄悄失效，
 * 红/绿不再可归因）。因此清单搬到本模块（纯数据、零依赖），两侧都 import。
 *
 * 当前为空：原先登记的两个 router 集成测试（task / generate）已随 enqueue 拆分
 * （mock 边界从 runner 改到 enqueue）恢复通过，按规范 11.12 第 3 条删掉，让它们
 * 回到门禁里被强制拦截 —— 留在这里会永久静默跳过，退化不会再被发现。
 */
export const KNOWN_FAILED_FILES = [];
