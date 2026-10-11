## Fixed

- **设置页外观分区布局与控件可见性**：一页到底改造后暴露的几处样式问题。
  - 分区节之间原先没有纵向间距（`section` 只有 `scroll-mt-6` 锚点补偿、不占布局），
    上一节卡片末尾紧贴下一节标题，读起来像同属一组：`SettingsShell` 给每个 `<section>`
    加 `mb-8 last:mb-0`。
  - 外观分区的「整卡可点」主题卡 / 档位药丸被 `radio-group` 基元的小圆点尺寸
    （`size-4 aspect-square`）钉死在 16px 宽，文字被压成竖排单字、内容溢出叠到下一节：
    调用处补 `size-auto! aspect-auto!` 把宽高与比例一并归还。
  - 基元自带的「中心圆点」选中指示器是给小圆点形态用的，在卡片 / 药丸形态下只会叠在
    文字上、表达不出新信息：外观分区这两处用法用 `**:data-[slot=radio-group-indicator]:hidden`
    隐藏它，选中态已由边框 + 底色表达。
  - 暗色下未勾选的 `Checkbox` 走 `border-input`（#26262e）叠卡片底（#16161c），对比度接近 0、
    16px 小框基本隐形：`checkbox` 基元给未勾选暗色档补可见边框与浅底
    （`dark:data-unchecked:border-ink/30 dark:data-unchecked:bg-ink/5`）。

## Affected

- `src/components/settings/SettingsShell.tsx`（分区节间距）
- `src/app/(main)/settings/components/AppearanceSection.tsx`（主题卡 / 档位药丸尺寸与指示器）
- `src/components/ui/checkbox.tsx`（暗色未勾选可见性）
