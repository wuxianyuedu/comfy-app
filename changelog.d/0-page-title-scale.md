## Changed

- **屏级标题（h1）收口到字阶档，并立判据 P83**：`globals.css` 里 `.u-title-page` 注明就是「页面级标题（h1）统一规范」，但它引入至今只有 1 处消费者，屏级标题实际写在 11 个 `h1` 上、尺寸有 18 / 20 / 24 / 34px 四五种 —— 同一个角色在不同屏大小不一，「改一下标题字号」退化成逐文件点名（与 §3.6.2 治颜色前同一形态）。
  - 数值提到 `@theme`：新增 `--text-section` / `--text-page` / `--text-hero` 三档，`.u-title` / `.u-title-page` 改为引用档位而非硬编码字面量（§3.2「魔法值提取到主题」）。
  - 新增 `.u-title-hero` 与 `--text-hero`：首页欢迎区大标题确实不是屏级那一档，但**例外必须有名字**，不能留成某处内联的 `text-[34px]` —— 否则「唯一档」这句话在第一屏就先破了。字号数值与原 `text-[34px]` 等值（2.125rem），**首页观感不变**。
  - 10 处 `h1` 改走档位：`error.tsx` / `not-found.tsx` 原 `text-2xl`（24px）与屏级档等值，**无观感变化**；`SettingsShell`（18→24）、`HistoryList` / `ModelLibrary` / `WorksGallery` / `ProjectOutputs` / `QueueMonitorView`（20→24）、`WorkflowLibraryHeader`（18→24）各屏标题统一到屏级档；`ProjectOutputs` 原叠的 `text-ink-bright` 去掉，颜色由档位给（深色下标题略暗一档，与其余各屏一致）。
- `scripts/check-ui-primitives.cjs` 新增 **P83**（棘轮，基线 0）：视图层 `<h1>` 的属性段必须出现屏级档之一（`u-title-page` / `u-title-hero` / `text-page` / `text-hero`），且不得再叠 `text-lg` / `text-[34px]` 这类硬写字号。属性段走 `readJsxAttrsPastTag` 平衡扫描 —— `className={cn("u-title-page", a > b ? … : …)}` 与 `className={[…].join(" ")}` 里都有 `>`，粗锚会在这些形态上漏计（P82 的同一教训）。
- **刻意不管的两处**：h2 / h3 不入本条（区块级标题保留 10.5–14px 的几档微排版，并成一档会压平信息层次，那是另一件事）；`ui/` 基元走既有豁免（第三方基元自带形态）。判据不越界，否则下一个人会拆掉合理排版去迎合机器。
- 规范：`docs/standards/03-样式与-tailwind.md` 新增 §3.10（三档职责、判据落点、新增一屏怎么做），`docs/generated/` 同步重渲染。

## Added

- `tests/check-ui-primitives.test.ts`：P83 五条差分回归 —— 无档位阻断、已走档但叠硬写字号仍计、三种合规出口都不计、**数组与 `cn(...)` 形态的 className 要读得到档位**（钉住粗锚会漏计的那个缺口）、h2/h3 不入本条。用例 312 → 317。
