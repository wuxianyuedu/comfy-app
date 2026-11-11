## Fixed

- RadioGroupItem 不再把整张卡片填成实心紫（#3553）：选中实心底（`data-checked:bg-primary`
  及其 `dark:` 档）从基元**根元素**下沉到 Indicator —— Indicator 只在选中态渲染
  （`keepMounted=false`），实心紫天然只落在 16px 小圆点本体；根元素只保留描边与结构类。
  根因是 base-ui 对 `render` 元素的 className 合并是**纯字符串拼接**
  （`mergeClassNames`，"rightmost first"，不走 tailwind-merge），基元根上的
  `data-checked:bg-primary` 与卡片形态调用方的底色类同 specificity 共存，胜负由
  tailwind 生成顺序决定，调用点无法可靠覆盖（此前外观分区只能靠再写一份
  `dark:` 变体组压住，ISSUE #3547 的 workaround）。卡片形态（外观分区主题卡）
  隐藏 indicator 后底色完全归调用方，AppearanceSection 的覆盖 hack 已随之删除；
  小圆点形态（CPU 限额、重绘面板、/ui-kit）视觉不变。基元测试补一条判据：
  选中态根元素类不含 `data-checked:bg-*`、实心底在 Indicator 上。
