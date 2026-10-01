## Fixed

- **standalone 产物的卫生从「按名字列黑名单」换成「顶层默认拒绝」，并把数产物那道判据接进了 `pnpm build`**（ISSUE #1217；规范 §7.2 第三件事之二 / §7.3 / §5 排障表新行）。三件事一起做，因为它们是同一个缺口的三面。

  - **定性：那份 `outputFileTracingExcludes` 不是键位写错，是 Turbopack 不读它。** 同一份源码、同一份 `next.config.js`，只换 bundler 各构建一次，**在剥离之前**数产物：

    | 构建方式（Next 16.3.5） | 顶层条目 | 真文件 | `changelog.d` | `docs/*.md` | `src/**/*.test.ts(x)` | `src-tauri` | `python-venv` | `db.sqlite*` | `.env` | `data/`（含密钥） | `log/` |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | `next build`（Turbopack，本仓库默认） | **40** | 19274 | 820 | 73 | 428 | 8520 | 5356 | 7（根级 3 条） | 1 | 2 | 123 |
    | `next build --webpack` | **10** | 3971 | 0 | 0 | 0 | 0 | 0 | 0 | **1** | **2** | **100** |

    顺带订正 §7.2 旧表的一行：那里写着「`./db.sqlite` 单文件条目 → 0（有效）」，本轮在同一处重数，
    Turbopack 下**单文件条目也不减**（产物根上 `db.sqlite`、`-wal`、`-shm` 三条都在）。结论方向没变，
    但「有一条 excludes 能用」这个印象是错的。

  - **但「切成 webpack」不是修法，两条实测理由**：① 这次真正要拦的那几样它一样拦不住 —— `.env` 照旧 1 份、`data/`（`app-settings.json` + `llm-secret.key`）照旧 2 份、`log/` 照旧 100 份，硬规则 17 的密钥面一点没收窄；② 本仓库的产物链是按 Turbopack 命名的（`check-standalone-contents.cjs` 的 `REQUIRED_RUNTIME_FILES` 逐个点名 `app-route-turbo` / `app-page-turbo` / `pages-turbo.runtime.prod.js`，§7.4 那条补件清单也是），换构建器等于重做整条产物链。
  - **减法侧因此只认产物层，而且改成默认拒绝**：`.next/standalone` 顶层只允许 `.next` `node_modules` `package.json` `public` `scripts` `server.js`（`src-tauri/static` 那层再加装配步产出的 `schema.sql` / `splash.html` / `index.html`）。`src` 不在任何一层，走「祖先放行、叶子逐文件判」——只放 `RUNTIME_SRC` 那一个文件（`reap-process.mjs` 与 `dev-launcher.mjs` 运行期要 import `src/lib/process/kill-process-tree.ts`，硬规则 3），`src/generated/*.json`（开发机自定义节点的解析结果）这类一律不进。判据侧同一份内容再持一份，**逐字同源由用例核对**；新增一项必须同改两处并写清「谁在运行期读它」，红话里就带着这句。实测这一刀剪掉之后运行不受影响：起 standalone 的 `server.js`，`/` 与 `/login` 200、`/api/health` 回 `db:"up"`、`/api/dev/build-id` 200、`/api/custom-nodes` 在 manifest 被剪掉之后走「未发现」出口而不是 500。
  - **判据现在自己会跑**：`pnpm build` 的顺序定成 `next build` → 预编译宿主 → 减法 → **数产物** → 冒烟（减法在数之前、冒烟在最后，只有它对最终产物负责）。此前这道判据只在人手与 `build-desktop` 的断言里出现，而 #623 之后无 CI 兜底 —— 所以「一条早就写好的产物判据在 master 上红了很久没人看见」本身就是这条 issue 的症状，不是它写坏了。
  - 顺带一条同族事实（写进 §7.2，别当巧合）：standalone 的 `server.js` 启动即 `process.chdir(__dirname)`，所以**任何运行期写入都会落在产物目录里** —— 本次复核时起了一次 standalone server，`data/`（含 `runtime-secret.json`）、`db.sqlite`、`log/` 当场出现在 `.next/standalone` 顶层，正是默认拒绝抓到的那三类；按名字的旧清单只点名了 `data/` 里那三个文件，目录壳与 `log/` 都是漏的。
- 判据：`tests/dist-artifact-hygiene.test.ts` 新增 5 条（两份顶层清单逐字同源且不为空、static 只比 standalone 多那三件、`src` 与 `next.config.js` 不在白名单里、凭空多一个顶层条目判红并点名（同一份目录先跑反向对照，证明不是恒红）、剔除侧真删一次且必需件与那条运行期 TS 源不被牵连、`main()` 里真接上了这一刀、`pnpm build` 链条的顺序）。变异验证三处：把判据的 `if (strayTop.length > 0)` 短路 → 红；把 `pruneStandaloneToAllowList` 改成直接返回空 → 红；两条各命中一条用例，还原后 29 条全绿。
