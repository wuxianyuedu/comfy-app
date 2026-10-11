## Added

- **`src/lib/core/**` 与 `src/lib/log/**` 的四条覆盖率门槛不再靠豁免过（ISSUE #1728）**：
  补 13 条用例把三个「此前零执行」的面照出来，**门槛一个数字没动**（issue 明写「写小等于
  把这条判据作废」）。四条红与实测差值原本精确到个位 —— core 差 **1 条语句 + 1 条分支**、
  log 差 **1 个函数 + 3 条分支**。全量跑（`node scripts/full-suite-run.mjs`）实测：

  | 目录 | statements | branches | functions | lines |
  | --- | --- | --- | --- | --- |
  | `src/lib/core/**`（门槛 96 / 90 / 97 / 98） | **96.74** | **90.4** | 98.11 | 98.83 |
  | `src/lib/log/**`（门槛 91 / 86 / 100 / 92） | 93.21 | **87.79** | **100** | 94.7 |

  四项由 `95.89 / 89.95 / 98.97 / 85.17` 抬起；全量 **678 份文件 / 8534 条通过**、
  门槛 `ERROR:` **0 行**，`scripts/.full-suite-freshness.json` 里那条点名 #1728 的豁免
  已被真凭证替换（`skippedReason` 消失）。

- **补的是哪三个零执行面**：
  - `src/lib/log/app-runtime-log.ts` 的 `writerFor()`（原本函数 11/12、分支 57.14%、语句 75%
    —— #1728 点名的最弱一份）。三条钉它的契约：launcher 经 `COMFYAPP_LAUNCH_STAMP` 透了戳时
    **续写 launcher 那一份**（`reuse` 的名字按 `runtimeLogFileName` 现算，不是抄字符串）、
    **先轮转再开**、句柄定下来后第二次写既不重开也不重跑轮转（进程内单例）；读不出戳时
    只给 `source`、把时刻交给 `openRuntimeLogWriter` 的默认参数。IO 层换成探针 + 临时目录，
    所以本用例不往仓库 `log/` 写字（AGENTS 硬规则 4 那条）。另两条补 `stringify` 的
    循环引用兜底与「父命名空间为空时子日志器不留空的 `:` 前缀」。
  - `src/lib/log/runtime-log-file.ts` 的 `compareRuntimeLogFiles` —— **整份函数此前零用例**，
    而它的文档把三级判据写得最细。五条：时刻序、**同秒两份的顺序与 `localeCompare` 相反**
    （`.` 码位 46 比 `-` 的 45 大一位，按名字比会把「第一次的失败现场」排到第二次后面）、
    旧固定名两个方向都排最前、两份都无时刻时退到名字序、同刻同序号落到第三级名字序。
  - `src/lib/core/repository-base.ts` 的 `create` 与 `src/lib/core/repository-film.ts` 的
    `listByStatus` —— 两者都是**公开 API 面上零执行**：前者因为每个子类各自重写 `insert`
    （要补自己的语义列），基类那套「标准 CRUD」其实只跑过三件套；后者是进程重启后的恢复扫描，
    钉的是按 `createdAt` 升序（先起先续）与**刻意不看归属**（补上归属条件就把「另一个用户那次
    没人续跑」的窗口重新打开）。

- **变异复核 7 项，抓到两处我自己的错**（逐条把修法退回旧形状、看红的是哪一条用例）：
  M1 摘掉 `compare` 的序号级 → 红；M2 去掉 `reuse` → 红；M3 去掉单例守卫 → 红；
  M4 去掉 `stringify` 的 `try` → 红（`TypeError: Converting circular struct…` 原样抛出）；
  M5 基类 `create` 改成回显入参 → 红（`expected undefined to be '[]'`）；
  M7 去掉 `orderBy` → 红。**M6 摘掉 `statuses.length === 0` 那道早退仍然绿**，
  于是我在用例注释里写的「空数组会生成 `status in ()`、SQLite 当场语法错」**是推论不是实测** ——
  注释按实测改成「省一次查询 + 不依赖方言对空 `in` 的处理」，并把那一条降级成**契约用例**
  （它钉调用方拿到的形状，钉不住那道守卫）。M7 的第一版也没钉住：自然扫描序恰好等于插入序，
  删掉 `orderBy` 照样绿；改成把**先落库那一行**的 `createdAt` 推到更晚、让两序相反之后才红。

- **两条「按构造就走不到」的分支登记成刻意排除项**（写在用例文件头注里，免得下一轮为凑数
  造反直觉夹具）：`parseRuntimeLogFileName` 的 `!source` / `!sm`（`FILE_RE` 命中必然让
  `STAMP_RE` 命中）与 `parseLaunchStamp` 的 `Number.isFinite` 假分支（四位年越不出 Date
  的表示范围）。为它们造夹具等于让覆盖率替假场景作证。

- 顺带记一条与本笔无关、但核对时量到的账：**§18.6 的门槛表是手抄副本、已与
  `vitest.config.ts` 漂开**（config 里 20 个目录带四维门槛、表里只有 9 行，
  `src/lib/log/**` 整条在规范里不存在；`src/lib/core/**` 那行写 95/95/90/90 而 config 是
  98/97/96/90）。修法要拍板（改成复算入口 vs 加一条元判据），所以另开 ISSUE #1733，
  不在本笔顺手改。
