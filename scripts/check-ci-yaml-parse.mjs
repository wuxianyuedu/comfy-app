#!/usr/bin/env node
/**
 * CI 配置文件的**独立 YAML 解析校验**（2026-11-02 补，背景见 ISSUE #3052 复核）。
 *
 * 仓库自带的 CI 判据（`tests/no-platform-ci-config.test.ts` 一族）按文本行 / 锚点形状
 * 解析 `.cnb.yml`——它们管「清单 ⇄ stage ⇄ 总账」这层语义，但**语法本身能不能被真
 * 解析器读下来**此前没有独立兜底（prettier 的 YAML 解析器不在依赖里）。本脚本用
 * `yaml` 包做这一层，只判三件事，不重复语义校验：
 *
 *   ① `.cnb.yml` 与 `.github/workflows/` 下每份 workflow **可解析**（语法错误、
 *      重复键都会在这里报错）；
 *   ② **锚点 / 别名引用合法**——`toJS()` 解析时未知别名、断掉的锚点直接抛错，
 *      这恰是 `.cnb.yml` 大量用 `&gates` / `*gates` 的结构风险点；
 *   ③ 基本形态：每处 `stages:` 数组里每格都有非空的 `name` 与非空 `script`
 *      （GitHub workflows 的 `steps` 不做这层要求，只要求可解析）。
 *
 * 跑法：`pnpm check:ci-yaml`（或 `node scripts/check-ci-yaml-parse.mjs`）。
 * 判据测试在 `tests/ci-yaml-parse.test.ts`。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseDocument } from "yaml";

/**
 * 纳入校验的 YAML 文件清单（仓库相对路径）。
 *
 * @param {string} root 仓库根
 * @returns {Array<string>} 仓库相对路径清单
 */
export function collectYamlFiles(root) {
  const files = [".cnb.yml"];
  const wfDir = path.join(root, ".github", "workflows");
  try {
    for (const name of readdirSync(wfDir)) {
      if (/\.(?:yml|yaml)$/.test(name)) {
        files.push(path.posix.join(".github", "workflows", name));
      }
    }
  } catch {
    // 没有 workflows 目录不算错误 —— 只校验存在的。
  }
  return files;
}

/**
 * 递归找出解析树里所有 `stages` 数组（形态无关地找，不假设 CNB 的事件键形状）。
 *
 * @param {unknown} node 已解析的 JS 值
 * @returns {Generator<Array<unknown>>}
 */
function* findStagesArrays(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      yield* findStagesArrays(item);
    }
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "stages" && Array.isArray(value)) {
        yield value;
      } else {
        yield* findStagesArrays(value);
      }
    }
  }
}

/**
 * 校验单份 YAML 文件，返回问题清单（空 = 绿）。
 *
 * @param {string} root 仓库根
 * @param {string} rel 仓库相对路径
 * @returns {Array<string>}
 */
export function checkYamlFile(root, rel) {
  const problems = [];
  const text = readFileSync(path.join(root, rel), "utf8");
  const doc = parseDocument(text, { uniqueKeys: true });
  for (const err of doc.errors) {
    problems.push(`${rel}: 解析失败 —— ${err.message.split("\n")[0]}`);
  }
  if (doc.errors.length > 0) {
    return problems;
  }
  let value;
  try {
    value = doc.toJS(); // 锚点 / 别名在这一跳真正展开，断引用在这里抛错。
  } catch (error) {
    problems.push(`${rel}: 锚点 / 别名解析失败 —— ${String(error).split("\n")[0]}`);
    return problems;
  }
  for (const stages of findStagesArrays(value)) {
    stages.forEach((stage, i) => {
      if (stage === null || typeof stage !== "object") {
        problems.push(`${rel}: stages[${i}] 不是映射`);
        return;
      }
      const stageMap = /** @type {Record<string, unknown>} */ (stage);
      if (typeof stageMap.name !== "string" || stageMap.name.trim() === "") {
        problems.push(`${rel}: stages[${i}] 缺非空 name`);
      }
      const script = stageMap.script;
      const scriptOk =
        (typeof script === "string" && script.trim() !== "") ||
        (Array.isArray(script) && script.length > 0);
      if (!scriptOk) {
        problems.push(`${rel}: stage「${String(stageMap.name)}」缺非空 script`);
      }
    });
  }
  return problems;
}

/**
 * 校验全部纳入面，返回问题清单（空 = 绿）。
 *
 * @param cwd 仓库根
 * @returns {Array<string>}
 */
export function main(cwd = process.cwd()) {
  const files = collectYamlFiles(cwd);
  if (files.length === 0) {
    return ["没有纳入任何 YAML 文件 —— 这条判据空转了"];
  }
  return files.flatMap((rel) => checkYamlFile(cwd, rel));
}

// oxlint-disable-next-line typescript/no-unnecessary-condition -- process.argv[1] 在 node -e / REPL 形态下实为 undefined，@types/node 标成 string
if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  const problems = main();
  if (problems.length > 0) {
    console.error(`[check:ci-yaml] ✗ ${problems.length} 处问题：`);
    for (const p of problems) {
      console.error(`  - ${p}`);
    }
    process.exit(1);
  }
  console.log(
    `[check:ci-yaml] ✓ ${collectYamlFiles(process.cwd()).length} 份 YAML 全部可解析、锚点合法、stage 形态完整。`,
  );
}
