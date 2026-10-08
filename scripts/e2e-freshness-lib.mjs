#!/usr/bin/env node
/**
 * e2e-freshness-lib.mjs — 「全量 e2e 的新鲜度账 + 每天首次跑的凭证」的纯逻辑（规范 §11.8）
 *
 * 这一层补的是 #1282 收尾时点名的那个洞：`pnpm test:e2e` 是**按需召唤**那一档，
 * 而它的触发条件一直不存在 —— 上一轮现场是入库的 linux 档基线被别线的产品改动
 * （`#1327` 改导航顺序）作废，**躺了两天**，靠「有人在 Issue 里点头让我手动跑一遍」
 * 才发现。像素档那边早就有「每档都有主」的判据；全量 e2e 这一档一条都没有。
 *
 * ## 档名不是 `process.platform`
 *
 * 像素基线**按平台分文件**（`-linux.png` / `-win32.png`），所以那一档的键必须是
 * `process.platform`。全量 e2e 没有这个问题：同一份 spec、同一份 fixture、同一台
 * 起得来的机器跑出来的结论对所有人成立。所以这里的档名是一个**常量**
 * （`E2E_TIER = "e2e"`），而「谁跑过」写在记录里的 `who` 一栏。
 *
 * ## 「每天首次提交执行一次」是怎么落地的
 *
 * 不是「判据里跑一遍 e2e」（那要起 webServer + 真浏览器，进钩子等于给每次提交加
 * 十几分钟），而是**给「跑过一次」留凭证**：
 *   · `pnpm check:e2e`（`scripts/e2e-run.mjs`）**跑绿**之后往
 *     `scripts/.e2e-freshness.json` 记一条（档名 + 时刻 + 谁 + 哪条命令）；
 *   · pre-commit 的 D 组跑 `scripts/e2e-freshness-gate.mjs`：当天还没有凭证 ⇒
 *     **拦住这次提交**并给出跑法；已经跑过（或这轮不打算跑、显式记了豁免账）⇒ 放行。
 * 于是「每次提交都跑」的代价没有落到任何人头上，而「一天里一次都没跑」从
 * 「没人知道」变成「提交被拦下」。
 *
 * ## 为什么是本文件纯逻辑、`e2e-run.mjs` 只管执行
 *
 * 判决必须**可被执行**（先例：`visual-gate.mjs` 的 `runGate` /
 * `visual-freshness-gate.mjs` 的 `runGate`，立案见 ISSUE #1356「源码文本断言不是
 * 执行记录」）。所以「给什么输入、判什么、退出码是什么」全部收在纯函数里，
 * 用例直接喂「无凭证 / 今天已有 / 昨天有 / 只记了豁免 / 凭证坏掉」五种形状。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { freshnessAge, isSameLocalDay } from "./fresh-ledger.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");

/** 新鲜度账文件（相对仓库根）。与像素那份**分开**：两者的档、命令与时效都不同。 */
export const E2E_LEDGER = "scripts/.e2e-freshness.json";

/**
 * 这一档的名字（常量，不是 `process.platform` —— 理由见文件头）。
 * 用常量是因为它同时出现在账里、判据话术里与用例里，写三遍就会漂。
 */
export const E2E_TIER = "e2e";

/** 跑一次全量 e2e 的**唯一入口**（判据与记账都点名它）。 */
export const E2E_COMMAND = "pnpm check:e2e";

/** 不想在当天跑时记的那条豁免账的 `how` 形状（前缀，后缀写理由）。 */
export const SKIP_PREFIX = "skip:";

/**
 * 读账（不存在 / 读不出 → `{}`；由判决把它当成「一档都没记」）。
 *
 * @param {string} [file] 账文件绝对路径
 * @returns {Record<string, unknown>}
 */
export function readE2eLedger(file = path.join(ROOT, E2E_LEDGER)) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

/**
 * 写一条记录（读回、合并、写回）。写失败返回原因，**不抛** ——
 * 记账失败不该把「e2e 已经跑绿」这个结论也一起作废。
 *
 * @param {Record<string, unknown>} entry
 * @param {string} [file]
 * @returns {string | null} 成功返回 null，失败返回原因
 */
export function writeE2eLedger(entry, file = path.join(ROOT, E2E_LEDGER)) {
  const ledger = readE2eLedger(file);
  ledger[E2E_TIER] = entry;
  try {
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * 一次「凭证」的**判决**：给定账与「现在」，今天该不该放行这次提交。
 *
 * 这是本层的全部判据，所以它必须可被执行（用例喂五种形状，见文件头）。
 *
 * @param {{ledger: Record<string, unknown>, now?: Date}} input
 * @returns {{exitCode: number, problem: string | null, age: string | null, skipped: string | null}}
 */
export function judgeE2eFreshness({ ledger, now = new Date() }) {
  const entry = ledger[E2E_TIER];
  const fix =
    `修法：跑一次 \`${E2E_COMMAND}\`（绿即记账），` +
    `或写明这次为什么跳过 —— \`node scripts/e2e-run.mjs --skip "原因"\`。`;

  if (entry === undefined || entry === null) {
    return {
      exitCode: 1,
      problem:
        `账里没有 ${E2E_TIER} 档的记录 —— 全量 e2e 从来没有被实证跑绿过。\n` +
        `        ${fix}`,
      age: null,
      skipped: null,
    };
  }
  if (typeof entry !== "object" || Array.isArray(entry)) {
    return {
      exitCode: 1,
      problem: `${E2E_TIER} 档的新鲜度记录不是对象 —— 形状见 fresh-ledger.mjs 的 freshnessRecord。`,
      age: null,
      skipped: null,
    };
  }
  const rec = /** @type {Record<string, unknown>} */ (entry);
  const at = String(rec.verifiedAt ?? "").trim();
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) {
    return {
      exitCode: 1,
      problem:
        `${E2E_TIER} 档的 verifiedAt（"${at}"）不是一个能解析的日期 —— ` +
        "「每天首次」的判据整条挂在它上面，写「最近」等于没记。\n" +
        `        ${fix}`,
      age: null,
      skipped: null,
    };
  }

  const how = String(rec.how ?? "").trim();
  const today = isSameLocalDay(new Date(ms), now);
  const age = freshnessAge(entry, now);
  if (today) {
    /* 当天跑过（或记了豁免）⇒ 放行。两种当天记录都算「今天这件事已经被回答过」：
     * 前者是「绿过了」，后者是「人明确说了这次不跑、并写了理由」。 */
    if (how.startsWith(SKIP_PREFIX)) {
      return {
        exitCode: 0,
        problem: null,
        age,
        skipped: how.slice(SKIP_PREFIX.length).trim(),
      };
    }
    return { exitCode: 0, problem: null, age, skipped: null };
  }
  return {
    exitCode: 1,
    problem:
      `今天是本工作日的第一次提交，而全量 e2e 上次跑绿是 ${age ?? "（无记录）"}` +
      `（account: ${at}）。\n` +
      `        它不在 \`pnpm check:all\` 里（要起 webServer + 真浏览器），` +
      `所以「上一次是绿的」这件事过去没有任何东西在守 ——\n` +
      `        现场就是入库的 linux 档基线被别线的产品改动作废、躺了两天。\n` +
      `        ${fix}`,
    age,
    skipped: null,
  };
}

/**
 * 一条「跑了」的记录（时刻 / 谁 / 命令）—— **记账与用例共用这一份**。
 *
 * @param {{now: Date, who: string, how: string}} input
 * @returns {{tier: string, verifiedAt: string, who: string, how: string}}
 */
export function e2eRecord({ now, who, how }) {
  return {
    tier: E2E_TIER,
    verifiedAt: now.toISOString(),
    who: who.trim(),
    how: how.trim(),
  };
}

/**
 * 一条「这次不跑」的豁免记录。**理由必须有实质内容** ——
 * 空理由 / 「稍后」这类占位与没记一样，而它比没记更坏（看起来有人回答过）。
 *
 * @param {{now: Date, who: string, reason: string}} input
 * @returns {{tier: string, verifiedAt: string, who: string, how: string}}
 */
export function e2eSkipRecord({ now, who, reason }) {
  return e2eRecord({
    now,
    who,
    how: `${SKIP_PREFIX} ${reason.trim()}`,
  });
}

/**
 * 豁免账里那条理由够不够实（判据用；`e2e-run.mjs --skip` 也拿它拦一次）。
 *
 * @param {string} reason
 * @returns {boolean}
 */
export function isUsableSkipReason(reason) {
  const v = reason.trim();
  if (v.length < 4) return false;
  return !/^(稍后|待定|回头|下次|tbd|n\/a|无|none)\.?$/i.test(v);
}

/**
 * 记一条「跑了」的凭证（`e2e-run.mjs` 跑绿之后调）。
 *
 * @param {{now?: Date, who: string, how?: string, file?: string}} input
 * @returns {{ok: boolean, note: string}}
 */
export function recordRun({ now = new Date(), who, how, file }) {
  const previous = freshnessAge(
    readE2eLedger(file ?? path.join(ROOT, E2E_LEDGER))[E2E_TIER],
    now,
  );
  const failure = writeE2eLedger(
    e2eRecord({
      now,
      who: who || "（未填）",
      how: how || E2E_COMMAND,
    }),
    file ?? path.join(ROOT, E2E_LEDGER),
  );
  if (failure) {
    return {
      ok: false,
      note: `（记账失败：${failure} —— e2e 的结论仍然有效，手工补 ${E2E_LEDGER}）`,
    };
  }
  return {
    ok: true,
    note:
      `已记 ${E2E_TIER} 档凭证（上次自证：${previous ?? "无记录"}）—— ` +
      `改 ${E2E_LEDGER} 时请连同提交，它是「这一档上次跑绿在什么时候」的唯一事实。`,
  };
}

/**
 * 记一条「这次不跑」的豁免（人明确回答过，而不是把判据绕过去）。
 *
 * @param {{now?: Date, who: string, reason: string, file?: string}} input
 * @returns {{ok: boolean, note: string}}
 */
export function recordSkip({ now = new Date(), who, reason, file }) {
  if (!isUsableSkipReason(reason)) {
    return {
      ok: false,
      note: `--skip 的理由太短或明显是占位（"${reason.trim()}"）—— 写一句能复核的话。`,
    };
  }
  const failure = writeE2eLedger(
    e2eSkipRecord({ now, who: who || "（未填）", reason }),
    file ?? path.join(ROOT, E2E_LEDGER),
  );
  if (failure) return { ok: false, note: `（记账失败：${failure}）` };
  return { ok: true, note: `已记「本次跳过」：${reason.trim()}` };
}

/** 仓库根是否有账文件（用例与 `--dry-run` 用）。 */
export function ledgerExists(file = path.join(ROOT, E2E_LEDGER)) {
  return existsSync(file);
}
