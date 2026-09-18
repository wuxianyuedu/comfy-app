## Changed

- **删掉 `WorkflowIOEntry.value`（旧「通用页签」写的全局覆盖）整档：历史落库数据不迁移，读到即丢**。通用页签早已移除，UI 只往模式覆盖层写（`modes[mode].defaultValue`），这一档只剩落库残留 —— 而它写在模式语境里永远不会被读到（模式覆盖恒压过它）。服务端 GET 重建不再透传该字段，下一次 PATCH 把残留一并清掉；客户端的 `WorkflowIOParam.value` 镜像、已无调用点的 `setIOValues` / `resetIOPreviewValues` 两个 store 动作、以及 `mergeExposedEntry` 的透传口径一并删除。
- `resolveEntryDefault` 回退链收成两档：`modes[mode].defaultValue` → 图内 `defaultValue`；**顺带把 `null` 判据收掉** —— 模式覆盖里的 `null` 不再算「有效默认值」（放行只会把 `null` 下发给 ComfyUI），一律回退图内值。
- 回归用例：`resolveEntryDefault 模式默认值 > 图内 defaultValue`（含「没开模式就不读模式覆盖」）、「模式覆盖为 `null` 不算覆盖」；COMBO 存量清洗的三条用例从 `value` 改到 `modes[mode].defaultValue`（非法值摘掉 / 合法值原样 / 候选表缺失不洗）；store 的陈旧实例降级用例改用仍存在的动作名。
