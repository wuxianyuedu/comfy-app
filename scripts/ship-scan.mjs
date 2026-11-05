/**
 * ship-scan.mjs — 平台清单的**翻页**与「这一格到底读成什么」的读数（ISSUE #2964）。
 *
 * 为什么单独一件：`ship-platform.mjs` 的职责是「平台对我们动作的应答」，而翻页是对
 * **清单接口**的读法 —— 页界、截断判定、三种未命中话术都跟着「一条清单怎么被读」动。
 * 叠在一起会把那一层推过 900 行硬闸（#2964 补读数时实测 920 行），所以按职责拆。
 *
 * 两种调用方各取一半：复用路径要「命中号 + 三种未命中读数」，落地判定只要「命中号」。
 * `capped` 只表示清单被页界截断，**不表示**「确实没有更多」。
 */
import { asArray } from "./ship-build.mjs";
import { LIST_MAX_PAGES, LIST_PAGE_SIZE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";

/**
 * 逐页扫 `list-pulls --state <state>`，每页跑一次 `visit`，命中即停。
 *
 * 为什么必须翻页（ISSUE #2964）：清单类接口都是分页的，只取第一页的匹配在
 * 「目标条目被更新的条目挤出首页」那一刻静默失效 —— 复用判定读不到它，
 * 行为退化成「没就建」，撞平台 409 才露头（实测开放 PR 11 条、页大小 10，
 * 最老那条永远不在首页）。页界与落地判定同一口径：有界扫，扫不到照实回，
 * **不假装「没有」**。
 *
 * @param {{run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult, slug:string, pages?:number, pageSize?:number}} ctx
 * @param {{state: string, visit: (json: any) => number | null}} step 每页的匹配器（返回 PR 号或 null）
 * @returns {{hit: number|null, scanned: number, ran: boolean, pageCount: number, capped: boolean}}
 *   `ran` = 至少拿到过一页；`pageCount` = 实际拿到的页数；
 *   `capped` = 页界被用完且最后一页仍是满页 —— 清单**可能还有更多**（ISSUE #2964：
 *   「扫完没找到」与「扫到上界没找到」不是同一件事，调用方要把这一格念出来）。
 */
export function scanPullPages(ctx, step) {
  /* 页界取自 ship-core 那份共用的（`LIST_MAX_PAGES` / `LIST_PAGE_SIZE`）—— 与
   * `resolveBuildSn` 同一口径，两处只留一份常量，改一处即两处（ISSUE #2964/#2950）。 */
  const { pages = LIST_MAX_PAGES, pageSize = LIST_PAGE_SIZE, run, slug } = ctx;
  let ran = false;
  let scanned = 0;
  let pageCount = 0;
  for (let p = 1; p <= pages; p += 1) {
    const got = cnbJson(run, [
      "pulls",
      "list-pulls",
      "--repo",
      slug,
      "--state",
      step.state,
      "--page",
      String(p),
      "--page-size",
      String(pageSize),
      "-v",
    ]);
    if (!got) {
      break;
    }
    ran = true;
    pageCount = p;
    const list = asArray(got.json);
    if (!list || list.length === 0) {
      break;
    }
    scanned += list.length;
    const hit = step.visit(got.json);
    if (hit) {
      return { hit, ran, scanned, pageCount, capped: false };
    }
    if (list.length < pageSize) {
      break;
    }
  }
  /* 最后一页恰好是满页、而循环用完页界 ⇒ 清单被截断，**不是**「确实没有更多」。
   * 这一格若只回 `hit:null`，屏幕会把「扫到上界」读成「翻完了没找到」。 */
  return { hit: null, ran, scanned, pageCount, capped: pageCount === pages };
}

/**
 * 开放清单「没命中」时该念什么（ISSUE #2964）。
 *
 * 三种形态必须分开，否则屏幕把「取不到 / 扫到上界」读成「确实没有」：
 * ① 一页都没取到：**无法判断**是否已有 PR（不等于没有）；
 * ② 扫到页界还没命中：清单可能还有更多，后续建 PR 可能撞 409；
 * ③ 扫完（未被截断）确实没有：就是「没有这条分支的开放 PR」。
 *
 * 三句话都不改行为（照旧往下走、平台 409 仍是最后一道幂等防线）—— 缺读数不新增
 * 结论、也不撤销结论；但它们让屏幕能自证「幂等这一格到底成立没有」。
 *
 * @param {{hit: number|null, scanned: number, ran: boolean, pageCount: number, capped: boolean}} open
 * @returns {string[]} 要原样打出的行
 */
export function openScanReadout(open) {
  if (!open.ran) {
    return [
      "[ship] 没读到开放清单（平台没答 / list-pulls 取不到）⇒ 无法判断是否已有 PR" +
        "（不等于没有）：照旧往下走（落地判定 → 建 PR），平台 409 仍是最后一道幂等防线。",
    ];
  }
  if (open.hit === null && open.capped) {
    return [
      `[ship] 开放清单已扫 ${open.pageCount} 页 / ${open.scanned} 条仍未命中 ⇒ ` +
        "清单可能还有更多，这条分支的开放 PR 可能在上界之外；后续建 PR 可能撞 409" +
        "（那时平台的拒绝原文是唯一读数）。",
    ];
  }
  if (open.hit === null) {
    return [
      `[ship] 开放清单扫了 ${open.pageCount} 页 / ${open.scanned} 条：没有这条分支的开放 PR ⇒ 走建 PR。`,
    ];
  }
  return [];
}
