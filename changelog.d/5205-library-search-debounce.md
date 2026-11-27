## Fixed

- **角色库 / 资产库搜索加 250ms 防抖，敲字不再每次触发服务端列表查询（#5205，承接 #5195）**：两处此前把输入框的 `q` 直接喂给 `queryOptions`，连续输入 4 个字 = 4 次 `characterLibrary.list` / `asset.list` 全量筛选 + 列表重渲。现在改用既有地基 `useDebouncedValue`（规范 16「高频输入 → 低频消费」唯一出口）：输入框仍吃实时 `q`（显示零延迟），喂给列表查询与空态文案的是 250ms 防抖值，窗口内连续敲字只保留最后一次请求。改动落在两个 controller hook（`use-character-library.ts` / `use-asset-library.ts`），视图层不动；同类 `StyleLibrary`（自带 120ms timer）与 `ResourceLibrary`（`useMaterialLibrary` 自带 250ms timer）已各有防抖，按 issue 期望第 2 条保留即时语义、不改。用例：`use-character-library.test.ts` + 新增 `use-asset-library-debounce.test.ts` 各断言「输入即时 / 请求参数滞后且只取最后一次」。
