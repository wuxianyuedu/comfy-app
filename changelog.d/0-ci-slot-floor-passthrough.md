## Fixed

- **`tests/ci-slot-apply.test.ts` 的「不注入 probe 也要能真去建」回归位不再读未受控的实时盘面**：`applySlot` 新增 `floorBytes` 透传口（生产不给 = 走默认下限，行为一字不变），该用例钉 `floorBytes: 0`。此前这条用例走真实 `statfsFreeBytes` + 生产下限，缓存盘被填到下限以下后（槽自己就在占盘）对所有 PR 红——实测两个在飞 PR 被同一条 `expected +0 to be 1` 拦下。用例真正要钉的「对不存在的槽根向上找到最近存在的祖先」原样保留：量具读不到（null）照旧判不够。
