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
import { cnbRecords } from "./cnb-fields.mjs";
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

/**
 * 「这一笔 sha 是不是已经随某条**已合并**的 PR 落进主干」（ISSUE #2250）。
 *
 * 复用路径那条幂等只认**开放** PR：squash 合并成功那一刻 PR 转 `closed`，于是同一条
 * 分支上再跑一次 ship 会走「没有就建」，长出一条内容已在主干的幽灵 PR（能被再合一次、
 * 白烧一轮 CI）。这一格认的是平台的正面事实：`is_merged === true` 那条上的 `head.sha`
 * 与这一笔逐字相等 —— squash 改的是主干那笔的 sha，分支头那笔在 PR 记录里留着。
 *
 * 与 `ship-close.mjs` 的落地反查同一条取法：列表的 `--state` 没有 `merged` 这一档，
 * `closed` 里混着「合了」与「关了没合」，所以只认逐条 `is_merged`，不认状态词。
 *
 * @param {any} json `list-pulls --state closed` 的原样 JSON
 * @param {string} headSha 本地 HEAD 的 sha
 * @param {{unknownPr?: number|null} | null} [sink] 可选出站口：head.sha 逐字相同、
 *   而 `is_merged` **缺键 / null / 非布尔**的那条经它报出（`unknownPr` = 那条的号）——
 *   缺键不按「未合并」处理（ISSUE #3059），判读留给调用方（落地守卫按读数缺失收口）。
 * @returns {number | null} 命中的 PR 号；认不出（含空 sha）时 `null`
 */
export function findMergedPullForHeadSha(json, headSha, sink = null) {
  const sha = String(headSha ?? "").trim();
  if (!sha) {
    return null;
  }
  for (const p of cnbRecords(json)) {
    /* head 是平台给的（形状不在本仓手里），按信封收窄后取 sha。 */
    const head = /** @type {{sha?: unknown} | null} */ (
      typeof p?.head === "object" && p.head !== null ? p.head : null
    );
    if (String(head?.sha ?? "") !== sha) {
      continue;
    }
    if (p?.is_merged === true) {
      return Number(p.number);
    }
    if (typeof p?.is_merged !== "boolean" && sink) {
      sink.unknownPr = Number(p.number) || null;
    }
  }
  return null;
}

/**
 * 「这条**分支**是不是已经随某条已合并的 PR 落过地」—— 按 `head.ref` 认（ISSUE #3642）。
 *
 * 与上一条同一份判据（closed 清单里逐条认 `is_merged === true`），匹配键从 sha 换成
 * ref：squash 合并之后在同一条分支上补一笔再跑 ship，分支头已是新 sha，按 sha 永远
 * 对不上那条历史 PR —— 而平台上它还挂着这条分支的名字（#3642 现场：内容已随 #3640
 * 落地的分支照样派生出重复 PR #3641 + 一轮白烧的红 CI）。只认严格 `true`：关了没合的
 * 不算（那条分支可以再开 PR）；`is_merged` 缺键也不算 —— 按分支认本来就是较弱的证据，
 * 缺读数不拦建 PR（与 sha 形的「缺键退 5」刻意不同档，两种在读数上要分得开）。
 *
 * @param {any} json `list-pulls --state closed` 的原样 JSON
 * @param {string} [branch] 源分支名（不含 `refs/heads/`）；findLandedPull 的 ctx 里是可选
 * @returns {number | null} 命中的 PR 号；认不出时 `null`
 */
export function findMergedPullForBranch(json, branch) {
  const name = String(branch ?? "").trim();
  if (!name) {
    return null;
  }
  for (const p of cnbRecords(json)) {
    const head = /** @type {{ref?: unknown} | null} */ (
      typeof p?.head === "object" && p.head !== null ? p.head : null
    );
    const ref = typeof head?.ref === "string" ? head.ref : "";
    if (ref === `refs/heads/${name}` && p?.is_merged === true) {
      return Number(p.number);
    }
  }
  return null;
}

/**
 * 落地判定（ISSUE #2250 / #3642）：这条分支的内容是不是已经随某条**已合并**的 PR 进过主干。
 *
 * 为什么问平台而不问 diff 或 `merge-base`：squash 合并只保证**内容**相同，主干那笔 sha
 * 与分支头不同，祖先判据对它恒假。平台在 PR 记录里留着 `head.sha` / `head.ref` 与
 * `is_merged`，这些才是正面事实。两档命中分开报（`kind`）：sha 命中是「这一笔已经在
 * 主干里」的强证据；ref 命中是「这条分支的历史 PR 已合并」的弱证据（分支上可能还有
 * 未落地的新提交）—— 两者都停建 PR，话术各念各的。
 *
 * 有界扫（页参数与那一路一致）：扫不到就照实念，**不撤销结论** —— 「取不到」不等于
 * 「没落地」，那一格照常建 PR。
 *
 * @param {{run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult, slug:string, headSha:string, branch?:string, pages?:number, pageSize?:number}} ctx
 * @returns {{prNumber: number | null, kind: "sha" | "branch" | null, unknownPr: number | null, scanned: number, ran: boolean}}
 *   `unknownPr`：head.sha 逐字相同而 `is_merged` 缺键的那条（ISSUE #3059，判读交给调用方）。
 */
export function findLandedPull(ctx) {
  const { slug, headSha, branch } = ctx;
  /** @type {{unknownPr?: number|null, kind?: "sha"|"branch"|null}} */
  const sink = {};
  const scan =
    slug && headSha
      ? scanPullPages(ctx, {
          state: "closed",
          visit: (json) => {
            /* sha 先于 ref：逐字相同是更强的证据，同一页里两者都在时按 sha 报。 */
            const bySha = findMergedPullForHeadSha(json, headSha, sink);
            if (bySha) {
              sink.kind = "sha";
              return bySha;
            }
            const byBranch = findMergedPullForBranch(json, branch);
            if (byBranch) {
              sink.kind = "branch";
              return byBranch;
            }
            return sink.unknownPr ?? null;
          },
        })
      : { hit: null, scanned: 0, ran: false };
  return {
    prNumber: sink.unknownPr ? null : (scan.hit ?? null),
    kind: sink.unknownPr ? null : scan.hit ? (sink.kind ?? null) : null,
    unknownPr: sink.unknownPr ?? null,
    scanned: scan.scanned,
    ran: scan.ran,
  };
}
