#!/usr/bin/env node
// @ts-nocheck -- 写端点同源闸覆盖判据（供 .githooks/pre-commit 调用）
/**
 * 写端点同源闸覆盖（#4723，#3904 的子项）—— 硬闸，无基线、无豁免清单。
 *
 * 背景：`multipart/form-data` POST 与带查询串的 DELETE 属于 CORS「简单请求」，
 * 不经 preflight，恶意网页可对本地服务盲发写请求；而 `requireRequestUser()`
 * 在本机单用户模式下恒回落演示用户放行 —— 鉴权层不构成边界，真实边界是同源。
 * 此前同源闸只在 schema/push 一处实现（#4040），没有沉淀为统一入口；本判据把
 * 「凡带写方法（POST/PUT/DELETE/PATCH）的 REST 路由必须过
 * `~/server/lib/same-origin` 的 `rejectCrossOriginWrite()`」机器化，防后续
 * 新增写端点漏挂。
 *
 * 用法：
 *   node scripts/gates/check-write-origin-gate.cjs   # 全量扫描（每次提交都跑）
 */
const fs = require("node:fs");
const path = require("node:path");
const { gateFail, gatePass } = require("../ci/ci-log.mjs");

const ROOT = path.resolve(__dirname, "../..");
const API_DIR = path.join(ROOT, "src", "app", "api");
const WRITE_METHOD_RE = /export\s+(?:async\s+)?function\s+(?:POST|PUT|DELETE|PATCH)\s*\(/;
const HELPER = "rejectCrossOriginWrite(";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.name === "route.ts") {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
for (const file of walk(API_DIR)) {
  const src = fs.readFileSync(file, "utf8");
  if (!WRITE_METHOD_RE.test(src)) {
    continue;
  }
  if (!src.includes(HELPER)) {
    violations.push(`${path.relative(ROOT, file)}（含写方法但未过同源闸）`);
  }
}

if (violations.length) {
  gateFail("写端点同源闸", violations, {
    detail: `缺同源闸的写路由 ${violations.length} 个`,
    hint:
      "判据是硬闸（无基线、无豁免）：带 POST/PUT/DELETE/PATCH 的路由必须调用\n" +
      "`rejectCrossOriginWrite(request)`（~/server/lib/same-origin），放在鉴权之后。\n" +
      "跨站「简单请求」不经 preflight，鉴权在单用户模式下不构成边界（#4723）。",
  });
  process.exit(1);
}
gatePass("写端点同源闸", `扫描 ${walk(API_DIR).length} 份 route.ts，写端点全部过同源闸`);
