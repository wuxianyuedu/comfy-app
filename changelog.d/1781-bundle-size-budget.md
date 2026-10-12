## Added

- **bundle 体积预算：client chunk 的 gzip 总量 + 文件数棘轮**（ISSUE #1781，从 #1777「性能优化」清单里分出来的真缺口）。清单原稿写「在 CI 里加 bundle size budget」——**方向对，但本仓没有 CI**（`.cnb.yml` 随 #623 删除），所以落点不是「阈值定多少」，而是「挂在哪、谁来跑」。选定形态 **B + C**：`pnpm check:bundle` 是按需入口，同一脚本也挂在 `pnpm build` 收尾（构建已经发生、不额外买成本）。**不进 pre-commit**：`next build` 实测 26–33s（冷 / 热一样），半分钟 × 每次提交仍然不值，还会推高 `--no-verify` 的动机。
  - 判据 `scripts/check-bundle-budget.cjs`，基线 `scripts/.bundle-budget-baseline.json`（头部记 raw / gzip / 文件数三个**实测初值**）。测量面是 `.next/static/chunks` 下所有 `.js`（Turbopack 默认链，与 `pnpm analyze` 的强制 `--webpack` 别混着比）。
  - **抖动实测**：三次构建（热 / 热 / 冷，删过 `.next/cache`）gzip 总计一个字节都不差、同名字节差异 0 —— 因为 Turbopack 的 chunk 名是内容哈希、且口径按 basename 对齐（唯一会变的 `BUILD_ID` manifest 不在测量面内）。
  - **不是空转**：把基线掏空 4 KB 即红；新增一个 chunk 让文件数上升也红（文件数比总量更敏感 —— 实测 shiki 探针 gzip +49.6% 的同一次文件数 +193）。
  - **例外流程**：确认体积值得，就在 PR 里贴 before/after 两档读数 + 理由，评审确认后带 `--allow-increase` 重跑 `--update` —— 不带它 `--update` **拒绝抬高**基线（同 `check-overlay-z.cjs` 那批棘轮）。

## Tests

- `tests/check-bundle-budget.test.ts`：产物缺失跳过 / 测量面退化判红 / 基线缺失判红 / 掏空基线变红 / 文件数上升变红 / `--update` 拒涨（`--allow-increase` 才放行）/ `--report` 恒 0。变异核过：把「gzip 上升」那条判断改坏 → 对应用例当场红。进 `scripts/fixed-structural-tests.mjs` 固定清单（回潮形态是「往入口加一个大依赖」，住在各处组件里、import 图带不进来）。

## Docs

- 规范 §13.5.4 的按需档表格新增一行（bundle 体积预算）+ 一节讲清形态选择、测量口径四条、例外流程；§13.5.3 欠账条目 2 的措辞不动；launch-and-build §7 的构建表新增一行。
