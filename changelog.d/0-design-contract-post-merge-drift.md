## Fixed

- **两笔合并叠加出来的契约陈旧引用，逐处订正**（**13 处主张**：`docs/DESIGN.md` 8 处、判据用例 2 处、规范 03 源 3 处；
  `docs/generated/03-样式与-tailwind.md` 由 `pnpm doc:gen` 随源重生成，未手改）。
  触发的不是一个人：**`602294c7`（#1691）撤掉 `hero` 字阶档**，而**品牌紫深化那一刀（`2d5e0761`，#1715）改了 token 的值** ——
  两笔各自都过了门禁，叠在一起却留下了一批「文档说它是现值、代码里已经不是」的引用。
  这些引用**不会报红**，因为没有任何判据读它们（下面「为什么没人拦」那节）。

  | # | 位置 | 从前写的 | 现在写的 | 为什么这条是错的 |
  | --- | --- | --- | --- | --- |
  | 1 | `docs/DESIGN.md` frontmatter `typography.hero-lg` | 34px 那一档还在 | 删掉 | `--text-hero` / `.u-title-hero` 随首页欢迎区一起退役，`grep -c hero src/app/globals.css` = **0** |
  | 2 | 同上 `components.button-default-hover` | `rgba(124, 92, 252, 0.8)` | `rgba(133, 87, 222, 0.8)` | 它是 `hover:bg-primary/80` 的压平值，`--color-primary` 已是 `#8557de` |
  | 3 | 同上 `components.button-primary-soft` | `rgba(139, 92, 246, 0.15)` | `rgba(141, 80, 226, 0.15)` | 同理，来自 `bg-primary-500/15`，实心档已深化为 `#8d50e2` |
  | 4 | 「透明度 `/N`」那条 | 举例用旧 rgba | 换新值，并把「这三段没有读者」写进去 | 举例即文档 |
  | 5 | 「档名必须是 t-shirt 尺寸」那条 | 现势地列着 `--text-hero` 同名类 | 摘掉，改写成过去式并指回「字阶只有三档具名」 | 那一档不存在了 |
  | 6 | 两处「四档」 | 「作用域只有上面**四档**标题」/「上面『字阶只有**四档**』那张表」 | 三档 | `#366` 的标题在上游那一刀里已改成「三档具名」，正文另两处没跟手 |
  | 7 | 渐变「两端与现有 token 逐字同值」 | 现在时 | 改成「**当时**逐字同值」并写明起点像素**已经变了** | `#7c3aed` 是当时的 `--color-primary-600`，现在是 `#7a3fd0` —— 渐变走 `var()`，所以它**跟着变了**，这是 token 化的收益而不是回归 |
  | 8 | 光晕「`#7c5cfc` 逐字节就是那个值 ⇒ 零像素」 | 现在时 | 「收口那一刻」+ 现在 `#8557de` | 同第 7 条，同一个理由 |
  | 9 | `tests/design-md-contract-sync.test.ts` 的 `EXEMPT` | `["section","page","stage","hero"]` | 摘掉 `"hero"` | 白名单里留一个不存在的档名 = 给「以后把它加回来」预先放行，而这一族的成立理由恰恰是「它得有名字」 |
  | 10 | `tests/theme-token-single-source.test.ts` 的注释 | 列举 `.u-title-hero` | 三档 | 注释指着一个不存在的类 |
  | 11 | 规范 03 §3.6.2 两处 | 「品牌紫 `#7c5cfc` 当底色可以、当浅底上的文字色对比度不够」 | 按当前三个读数重写（4.38 / 4.76 / 7.46）并指回 DESIGN 的算式表 | **这是真矛盾**，不只是旧值：深化后当底已**过** AA，原句的前提没了；而它恰恰是「为什么要两颗 token」这条判据的论证 |
  | 12 | 规范 03 §3.6.1 的 chip 举例 | 「chip 的**文字色**（`#7C5CFC` 等）」当作现存例子 | 换成 `#a78bfa`，并点名 `PARAM_CLASS_COLOR` 与 `canvas-types.ts` 两张表 | 全库 `#7C5CFC` 只剩文档命中，`src/**` 里 0 处 —— 举例举着一颗代码里已经不存在的色值 |
  | 13 | §3.6.2「实测出的反例：`--color-primary: #7c5cfc`」 | 像在读现值 | 加「那时有值」 | ISSUE #672 的取证时间，不是今天 |

## 为什么这批漂移没人拦（记下来，别再当「跑过门禁就没事」）

`tests/design-md-contract-sync.test.ts` 只做两件事：**正文引用的裸 `--color-*` 必须在编译产物里有声明**，
以及 **Colors 那张贴合表里「单一 hex」的格子必须等于解析出的两态值**。它**不读 frontmatter**，
而 `docs/standards/**` 里的散文更不在任何判据射程内。⇒ 上表第 1–5、7–8、11–13 条这类
「文档里以现在时陈述一个取值」的句子，**改错了不会红**。
这一格已在 §「frontmatter 的色值是压平后的」那条里写明：改色或退役档位时
`colors` / `components` / `typography` 三段要**点名重读**，不能只跑判据。

**没有为此新写一条扫描器**（§12.18 第 24 条）：拿正则去判「散文里的 hex 是不是过时」要么误报一片、
要么静默漏，而这次的实际成因是**两次各自合规的改动叠加** —— 能防的那一层是「改 token 值时把引用点列全」，
所以下面那条复算入口比一条启发式判据有用。

## 复算入口（下次改色/退役档位先跑这两条）

```bash
# ① 旧值还有没有以「现值」的形态留在文档里：把要改的那颗 hex 逐颗全库扫
git grep -inE "7c5cfc|8b5cf6|7c3aed|6d28d9" -- docs src tests scripts | grep -v changelog.d
# ② 退役的档名还有没有留在 frontmatter / 判据白名单里
git grep -n "hero" -- docs/DESIGN.md tests/design-md-contract-sync.test.ts src/app/globals.css
```

第 ① 条**给出的是候选清单，不是漂移清单**（实测 46 行：`src/` 32、`docs/` 11、`scripts/` 2、`tests/` 1）——
本笔只动其中**以现在时陈述旧值**的那几条；其余逐条判定后留下两类正当命中：
过去式叙述（「旧值」「那时有值」「写死 `#7C5CFC` 的迁移前状态」）、以及**内容类型色**
（`custom-nodes.ts` 的类别色、`WorkflowPortHandle` 的端口色…）。
第 ② 条在 `globals.css` 上应当**零命中**（实测 0），零命中是「档真的退干净了」的自证。

## 顺带查出的一条（已开 ISSUE #1717 交出去，本笔不改代码）

复算入口 ① 在 `src/` 的 32 行里，**21 行是旧品牌值 `#7C5CFC`**（12 个文件）。`pnpm theme:check` 报
「未豁免 0 处」是真的 —— 它只数「有没有没登记的品牌裸值」，**不校验豁免理由里那句「与某某 token 同值」**。
按那句尺一量，**四处自称与品牌同值的站点已经过期**：`scripts/check-theme-colors.cjs:368`（选中高亮环）、
`:382`（模型封面渐变）、`:407`（W 徽标渐变），以及 `ContentAssetNode.tsx:24` 的注释「类型配色
（与 globals.css token 1:1）」。
⇒ 本仓现在**并存两颗紫**：UI 侧 `#8557de`、画布内容侧 `#7C5CFC`。这不是回归（端口类型色本来就该独立），
但「注释说跟、代码不跟」这一格不许长期留着 —— **跟手还是声明不跟手要拍一条**，
选项与代价（含「像素档已撤，改完没有自动回归能证明改对了」这条边界）都写在
[ISSUE #1717](https://cnb.cool/moon-read/comfy-app-t3/-/issues/1717)。
代码与本笔都不动它：改的是画布可见配色，而那条线才有资格定它该不该跟品牌走。

## 验证

| 项 | 结果 |
| --- | --- |
| `tests/design-md-contract-sync.test.ts` + `theme-token-single-source.test.ts` | 58 passed（含把 `EXEMPT` 摘掉 `"hero"` 之后那条） |
| 摘掉 `EXEMPT` 里的 `"hero"` 后反向自证 | 手工在 `@theme` 里加回一颗 `--text-hero:` ⇒ 该条当场报「这些档名会让 cn() 把字号当颜色合并掉：hero」；删掉即绿 —— 证明这条判据**真的在看白名单**，不是空转 |
| `pnpm doc:gen` | ✓ 重生成 30 份，`docs/generated/03-样式与-tailwind.md` 随源更新（生成物未手改） |
| `pnpm doc:check` | ✓ 文档引用与权威源一致 |
| `pnpm theme:check` | ✓ 未豁免 0 处（本笔没动 CSS） |
| 复算入口 ② 在 `src/app/globals.css` 上 | 0 命中 |
| `.githooks/pre-commit` | 见下方提交 |
