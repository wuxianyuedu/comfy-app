## Fixed

- **「界面小字看不清」的根因是档写低了，不是字体也不是对比度**（ISSUE #1751）。量完的结论：`--color-ink-muted` 在深色四种底（`#14141a`/`#0a0a0f`/`#16161c`/`#1a1a24`）上是 **6.24–7.15**，AA 正文线 4.5 / AAA 7.0 —— 早就过了，所以「换颜色」不解决问题，**12px 的中文笔画**才是。真正对不上的那一格是：同一个角色（屏级副说明）在两屏吃 `text-xs`(12px)、在隔壁九屏吃 `text-sm`(14px)。
- **「模型适配 / 模式契约」两屏自绘页头迁 `ui/page-header`**（一次修三件：标题档 14→24、副说明档 12→14、层级 `h3`→`h1`）。两屏此前是 `h3` + `.u-title`(14px 卡片档) + `p.text-xs`(12px)，**连 `.u-title-page` 都没有** —— 于是 P83（只管 `h1` 的字阶档）与 P86（锚 `.u-title-page` + `mt-1 text-sm`）**两条都看不见它们**：P86 要 `text-sm` 才起跳，**档写低反而绕过了它**。这是判据的一个真实缺口，不是某次疏忽。屏名从注册表取（`pageHeaderTitle(...)`），与侧栏 / 页签同一个出处。
- **`SectionLabel` 抽成 `~/components/ui/section-label`（消手抄对）**。两屏此前各抄一份同样的实现（连注释都写着「与另一屏同一形态」），同一个角色在两个形状里漂。抽成一件之后由 `tests/design-md-contract-sync.test.ts` 的 `FAMILIES` **开第 6 族**守「只许有一个出处」。
- **4 处段级整句中文说明升回 12px**（`studio/ModelLibrary`、`studio/ProjectCanvasSettings`、`project-home/ProjectHomePage`、`workshop/AgentOverlay`）：它们此前落在 11px / 10px 上。**记号的四类不动** —— `font-mono` 机器 id、`tabular-nums` 计数、`bg-subtle rounded-* px-*` 胶囊、`WorkshopStageBody` 的状态胶囊，那本来就是「小一档的标记」，并到 12px 只会把密集容器的行挤开。

## Added

- **新一条归零等式：`.u-title-page` 之后 4 行内的第一个 `<p>` 不许低于 `text-sm`**（`tests/design-md-contract-sync.test.ts`）。它与 **P86 互补、各判一头** —— P86 判**形状**（`.u-title-page` + `mt-1 text-sm` 同现），它判**档**、且**不看间距档**（`mt-1` / `mt-2` 都算），于是补上「手搓 + 写低」这一格。带三向自证：正例必抓（`text-xs` / `text-2xs` / `text-3xs` 三档都喂）、`text-sm` 不抓、`titleSuffix` 那枚 `<span>` 不抓（判据只认 `<p>`）、第一个 `<p>` 之后的段落不抓。

## Tests

- `tests/design-md-contract-sync.test.ts`：`FAMILIES` 第 6 族「段级小标题（标题 + 同行 hint）」——三枚标记全命中才认（`mb-2 flex flex-wrap items-baseline gap-x-2` / `text-ink text-sm font-semibold` / `text-muted-foreground text-xs`），实测恰好只有实现自己一处：`ComfyuiStoragePaths` 那行有同样的 wrapper 与 hint 档但标题是 `font-medium`（另一档，刻意不同形）、`AppearanceSection` 的 wrapper 是 `gap-2`、`FinalComposer` / `WorkshopAside` 没有段级小标题的 wrapper。带手抄样本 + 两个反向样本（屏级页头 / 段头胶囊都不许被同一组标记抓到）。另加归零等式与它的负控制两条。
- `tests/page-name-single-source.test.ts`：`PAGE_HEADER_CONSUMERS` 补进这两屏（8 → 10 项），把「新屏手搓页头」的具名清单覆盖面与本次迁移对上。
- 负控制（「第二份出处必须被抓住」）实测有效：往 `ModelAdaptersView` 里塞回一份手抄的 `SectionLabel`，判据当场报 `段级小标题（标题 + 同行 hint）的类名组合又出现了第二份出处`。

## Docs

- 规范 03 §3.10.1 新增**三档对照表**（屏级 14 / 段级 12 / 记号 11–10）+ 两条判据（P86 判形状 / 归零等式判档）的分工与各自绕过口，并把「没收的剩余债」登记在案（仓里还有 **61 处** `<p>` 落在 11/10px：多数刻意、**没有判据**，要收得逐屏看形态定档 —— 而像素基线层已整档撤除，**不开**会误伤一片的宽判据）。
- `docs/DESIGN.md` §Typography 同步三档口径与两条判据的分工；§Components「屏级页头」补上「档」这一头与本次迁移；`FAMILIES` 从五族改六族。
