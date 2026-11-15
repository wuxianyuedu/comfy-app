// ── freshness 账本的**写侧**（ISSUE #3858 拆出）──────────────────────────
//
// `freshness-ledger.mjs` 是账的**判据与格式**（读 / 判 / 格式化），本模块是
// **记账动作**（写跑绿记录 / 写豁免）。从原文件原样搬出：原文件顶到 900 行
// 硬闸（§12.6 R5），按「判读 vs 记账」拆开。依赖只进不出 —— 判据仍只有
// `freshness-ledger.mjs` 一份，本模块 import 它，不反向。
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  freshnessReading,
  freshnessRecord,
  freshnessTrack,
  isUsableSkipReason,
  readFreshnessLedgerAt,
} from "./freshness-ledger.mjs";

/** 原子写账本（ISSUE #3858）：tmp + rename，与 launcher 的 `writeJson` 同口径 ——
 *  直写被中断会留截断 JSON，而读取侧把坏 JSON 折成空账（等于账面清零）；
 *  并发记账的后写者也不再以旧快照整份覆盖（读-改-写的窗口仍在，但不再产生
 *  「半截文件」这种不可收拾的残留）。
 * @param {string} file
 * @param {Record<string, unknown>} ledger
 */
function writeLedgerAtomic(file, ledger) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 临时文件清不掉就留着：它不在任何收集面 / 判据里。 */
    }
    throw error;
  }
}

/**
 * 把一档的**跑绿**写进它那份账（返回给输出用的一句读数）。
 *
 * 三条边界（从各档跑法脚本内联那段收上来的，由几条账共用）：
 *   · **只有「检查档」记**：录基线 / 录快照本身**不是**自证。
 *   · **只有绿了才记**：红着的时候记一条「我跑过」会把「跑过」与「跑绿过」混成一件
 *     事，而那正是这条账要防的。
 *   · **写账失败不算跑法失败**：跑法的结论已经拿到了，返非零会把两件事混成一句
 *     「跑法挂了」。所以只提示、由调用方决定。
 *
 * 返回 `{ note, previous }`：`note` 是给人读的一句（写盘失败时也带着失败原因），
 * `previous` 是**写之前**那一档上次自证距今多久（账的价值在于被看见，不是被写下来）。
 *
 * **两件事各是一栏，回答的是两个不同的问题**（缺任一条这层账就退化）：
 *   · `key` —— **记给哪一档**。缺省回退到 `track.key`；分档的跑法（按平台或按环境）
 *     必须显式传那一档的键，否则「另一档录一次」只会写进当前键、那一档永远「没有记录」。
 *   · `how` —— **「实际跑绿的那条命令」，不是这一档的名义跑法**。
 *     缺省取 `track.run`（绝大多数跑法只有一种形状）；跑法有多种形状时（降并发、指定档）
 *     必须写出真实的那一条，否则账面上看不出「这次是怎么证的」，
 *     下一个人按名义命令复跑又红、却指不出差别在哪。
 *
 * @param {{root: string, kind: string, who: string, key?: string, how?: string}} args
 * @returns {{note: string, previous: string | null}}
 */
export function writeFreshness({ root, kind, who, key, how }) {
  const track = freshnessTrack(kind);
  const writeKey = key ?? track.key;
  const file = path.join(root, track.ledger);
  const ledger = readFreshnessLedgerAt(root, track.ledger);
  const previous = freshnessReading(ledger[writeKey]);
  ledger[writeKey] = freshnessRecord({
    key: writeKey,
    verifiedAt: new Date().toISOString(),
    who,
    how: how?.trim() ? how.trim() : track.run,
    trackedBy: kind,
  });
  try {
    writeLedgerAtomic(file, ledger);
  } catch (error) {
    return {
      previous,
      note:
        `（记账失败：${error instanceof Error ? error.message : String(error)} —— ` +
        `${track.label}的结论仍然有效，手工补 ${track.ledger}）`,
    };
  }
  return {
    previous,
    note:
      `${track.label}已记账（上次自证：${previous ?? "无记录"}）—— ` +
      `改 ${track.ledger} 时请连同提交，它是「这一档上次跑绿在什么时候」的唯一事实。`,
  };
}

/**
 * 把一档的**豁免**写进它那份账 —— 「今天不跑，但理由有人回答过」。
 *
 * 与 `writeFreshness` 的唯一区别是记的形状：那一份带的是「跑绿的日期」，这一份带的是
 * `skippedReason`。两者都能让「每天首次」那条判据放行，但**读起来不一样** ——
 * 账面上因此看得出「今天跑过」和「今天说好不跑」不是同一件事（豁免不是绕过）。
 *
 * 理由不合用（过短 / 占位）时**抛**，由调用方转成退出码：与其记一条没有信息的账
 * 让人以为「已经处理过」，不如当场把这条命令退回去。
 *
 * @param {{root: string, kind: string, who: string, reason: unknown, field?: "skippedReason" | "dirtyReason"}} args
 *   `field` 缺省是「豁免」（`skippedReason`）；`dirtyReason` 是「这次改动不吃这一档」。
 * @returns {{note: string, previous: string | null}}
 */
export function writeSkipRecord({ root, kind, who, reason, field }) {
  const track = freshnessTrack(kind);
  /* `field` 区分**两种**「不跑」：`skippedReason`（今天故意不跑，理由要能复核）与
   * `dirtyReason`（这次改动确实不吃这一档）。两者都让判据放行，但账面上必须看得出
   * 它们不是同一件事 —— 混成一栏之后，「这一档三个月没跑」与「这三个月每次都说不吃它」
   * 会长得一模一样，而那正是这张账要防的形态。 */
  const written = field ?? "skippedReason";
  if (written === "skippedReason" && !track.skipHow) {
    throw new Error(`[freshness-ledger] ${kind} 档没有「豁免」这条出路`);
  }
  if (!isUsableSkipReason(reason)) {
    throw new Error(
      `[freshness-ledger] 理由（"${String(reason ?? "").trim()}"）不算「有人回答过」—— ` +
        "写清这次为什么不跑（占位词与过短的理由都被拦）。",
    );
  }
  const file = path.join(root, track.ledger);
  const ledger = readFreshnessLedgerAt(root, track.ledger);
  const previous = freshnessReading(ledger[track.key]);
  ledger[track.key] = freshnessRecord({
    key: track.key,
    verifiedAt: new Date().toISOString(),
    who,
    how: track.run,
    trackedBy: kind,
    [written]: String(reason).trim(),
  });
  try {
    writeLedgerAtomic(file, ledger);
  } catch (error) {
    return {
      previous,
      note:
        `（记账失败：${error instanceof Error ? error.message : String(error)} —— ` +
        `手工补 ${track.ledger}）`,
    };
  }
  return {
    previous,
    note:
      `${track.label}已记一条${written === "skippedReason" ? "豁免" : "「不吃这一档」"}（上次自证：` +
      `${previous ?? "无记录"}）—— 理由写在 ${track.ledger} 的 ${written} 里，改它时请连同提交。`,
  };
}
