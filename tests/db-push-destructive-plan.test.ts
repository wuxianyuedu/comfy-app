/**
 * `db:push` 写库前的护栏判据（ISSUE #5103）：drizzle-kit 误判产生 `delete from task;`
 * 时，必须在 `--force` 执行之前把它挡下来 —— 一旦执行，表数与结构复核都看不出
 * 整表数据没了。这里钉住两件事：① 清表语句不在自动应用白名单里；② 它的读数
 * 讲清「清空整张表的数据」，而不是被折成一句无人看懂的原始 SQL。
 */
import { describe, expect, it } from "vitest";

import {
  canAutoApply,
  describeRiskyChanges,
  pendingStatements,
  riskyStatements,
} from "../scripts/db/db-push-core.mjs";

/** drizzle-kit 被交互挡下时的输出形态（实测 #5103：裸 `.default(0)` 新列）。 */
const DRIZZLE_PLAN = `Reading config file
Warning  You are about to execute current statements:
delete from task;
ALTER TABLE \`task\` ADD \`sortOrder\` integer DEFAULT 0 NOT NULL;
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).`;

describe("清表计划的护栏（#5103）", () => {
  it("pendingStatements 取出清表语句，且它不在自动应用白名单里", () => {
    const pending = pendingStatements(DRIZZLE_PLAN);
    expect(pending).toContain("delete from task;");
    expect(canAutoApply(pending)).toBe(false);
    expect(riskyStatements(pending)).toContain("delete from task;");
  });

  it("describeRiskyChanges 把清表说成「清空整张表的数据」", () => {
    expect(describeRiskyChanges(["delete from task;"])).toContain("task（清空整张表的数据）");
  });

  it("正常加列仍在白名单里（护栏不把安全变更一起挡掉）", () => {
    const safe = ["ALTER TABLE `task` ADD `sortOrder` integer DEFAULT 0 NOT NULL"];
    expect(canAutoApply(safe)).toBe(true);
    expect(describeRiskyChanges(safe)).toEqual([]);
  });
});
