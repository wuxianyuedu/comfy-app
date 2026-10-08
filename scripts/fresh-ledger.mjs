#!/usr/bin/env node
/**
 * fresh-ledger.mjs — 「新鲜度账」的**清点内核**（规范 §11.8 的单一事实源）
 *
 * 同一件事实——「这一档上次被实证跑绿是什么时候、谁跑的、按哪条命令」——现在有三个
 * 消费方，两侧各有一份「新鲜度门禁 + 记账」：
 *   · **像素基线**档（`scripts/visual-freshness-gate.mjs` 判、`scripts/pixel-run.mjs` 记）；
 *   · **全量 e2e** 档（`scripts/e2e-freshness-gate.mjs` 判、`scripts/e2e-run.mjs` 记）。
 * 把记录形状、校验判据、年龄读数与读写各抄一份就是 §12.12 的孪生对：两边必然漂，
 * 而「漂」的表现是「一边判得严、一边判得松」——两张同名的账给出两种结论，
 * 谁都不知道该信哪一个。所以**形状与判据只写在这里，两侧 import**，各自只留差异
 * （哪几档、哪些档被 pending 豁免、账文件叫什么）。
 *
 * 分工（与 `PENDING_PLATFORMS` 那张「数量欠账」表并列，各管一件事）：
 *   · 本内核管**时效**欠账 —— 某一档的成套基线 / 全量套件**上次被实证跑绿是什么时候**；
 *   · pending 表管**数量**欠账 —— 某一档缺哪几张 PNG（只在那一档的机器上补录）。
 * 一档可以「一张不缺、但三个月没人碰过」—— 那正是本内核要治的形态。
 *
 * ⚠️ **「过期」这条判据刻意不做墙钟阻断**：结论只在**跑得动那一档的机器上**成立
 * （像素基线带平台名；全量 e2e 要真浏览器），拿墙钟去阻断等于让所有人卡在一个
 * **只有少数人能解**的账上。所以纪律收在**可观测的形状**上，而不是收在时钟上：
 *   ① 每一档**都必须有一条**记录（没有 = 这一档还停在「录过就算数」）；
 *   ② 记录必须写得清「谁 / 什么时候 / 按哪条命令复核的」（空着或写「稍后」都算没写）；
 *   ③ 记录**不许**挂在不存在的档上（删了那一档，账要同批抹掉）。
 * 「多久没跑算旧」由**人**按读数决定 —— 内核把它算出来、摆在输出里，但不下阈值。
 */

/**
 * 新鲜度记录的形状（**读写共用这一份**：各写一套时记出来的会被自己的校验判成缺字段）。
 *
 * @param {{platform: string, verifiedAt: string, who: string, how: string}} input
 * @returns {{platform: string, verifiedAt: string, who: string, how: string}}
 */
export function freshnessRecord({ platform, verifiedAt, who, how }) {
  return {
    platform,
    verifiedAt: verifiedAt.trim(),
    who: who.trim(),
    how: how.trim(),
  };
}

/**
 * 校验新鲜度账（`{档名 → 记录}`）。空 = 放行。
 *
 * 三个方向都拦：缺档（还停在「录过就算数」）/ 记录写不全（没人能按它去复核）/
 * 挂在非登记档上（删档不抹账，账就退化成一份没人认领的名单）。
 *
 * @param {Record<string, unknown>} ledger
 * @param {{required: string[], registered: string[], fix: string}} scope
 *   `required` = 必须有记录的档（登记档减去 pending）；`registered` = 全部登记档（孤儿检查）；
 *   `fix` = 缺记录时给的那条修法（两侧的补记命令不同，所以由调用方注入而不是写死在这里）
 * @returns {string[]} 问题清单
 */
export function checkFreshnessLedger(ledger, { required, registered, fix }) {
  /** @type {string[]} */
  const problems = [];
  for (const platform of required) {
    const entry = ledger[platform];
    if (entry === undefined || entry === null) {
      problems.push(
        `${platform} 档没有新鲜度记录 —— 这一档现在是「录过就算数」：` +
          "没有任何东西说清它上一次被实证跑绿是什么时候、按哪条命令。" +
          fix,
      );
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(
        `${platform} 档的新鲜度记录不是对象 —— 形状见 freshnessRecord。`,
      );
      continue;
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    /* 每一栏的下限只挡「空着 / 明显是占位」的形状，不拿字数去判「写得好不好」：
     * `who` 是个人名（"月读" 两个字完全够用），拿统一的字数门槛会把合法值判红 ——
     * 而一个会误杀合法输入的判据，下场是被人整条绕开。`how` 要的是**能照着重跑**的命令，
     * 所以它另有一档下限（一条真命令不会短于几字符）。 */
    /** @type {Array<[string, number]>} */
    const minChars = [
      ["verifiedAt", 4],
      ["who", 2],
      ["how", 6],
    ];
    for (const [field, min] of minChars) {
      const value = String(rec[field] ?? "").trim();
      if (value.length < min) {
        problems.push(
          `${platform} 档的新鲜度记录里 ${field} 没写清（"${value}"）—— ` +
            (field === "how"
              ? "这一栏要写**能照着重跑的那条命令**（写「稍后」「已复核」等于没写）。"
              : "这一栏是这条账存在的全部意义：谁、什么时候、按哪条命令复核的。"),
        );
      }
    }
    const at = String(rec.verifiedAt ?? "").trim();
    if (at && Number.isNaN(Date.parse(at))) {
      problems.push(
        `${platform} 档的 verifiedAt（"${at}"）不是一个能解析的日期 —— ` +
          "记账要能算「多久没跑」，写「最近」等于没写。",
      );
    }
  }
  for (const platform of Object.keys(ledger)) {
    if (!registered.includes(platform)) {
      problems.push(
        `新鲜度账里记着 ${platform} 档，但它不在登记口径里（${registered.join(" / ")}）—— ` +
          "删掉那一档就要同批抹账，否则这张表会退化成一份没人认领的名单。",
      );
    }
  }
  return problems;
}

/**
 * 「这一档上次被跑绿距今多久」—— 给输出用的一句读数（**不是判据**）。
 *
 * 只在记录写得全、日期解得开时给；否则返回 null（缺日期时算一个天数毫无意义，
 * 而把 null 当 0 天读会把「没记」显示成「刚刚跑过」）。
 *
 * @param {unknown} entry
 * @param {Date} [now] 便于用例喂固定时钟
 * @returns {string | null}
 */
export function freshnessAge(entry, now = new Date()) {
  if (entry === null || typeof entry !== "object") return null;
  const at = String(
    /** @type {Record<string, unknown>} */ (entry).verifiedAt ?? "",
  ).trim();
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const days = Math.floor((now.getTime() - ms) / 86_400_000);
  if (days < 0) return null;
  return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * 「同一个**日历日**」的判据 —— 两侧的「每天首次提交」都用它，所以只有一处口径。
 *
 * 按**本地时区**的日界，不按 24 小时窗口：人的记忆与工作节奏都是按日历日走的
 * （「今天提交过了吗」），而滚动窗口会把昨天 23:00 与今天 08:00 算成同一天的连续两次，
 * 于是「今天的第一次提交」在早晨被静默跳过。
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
export function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
