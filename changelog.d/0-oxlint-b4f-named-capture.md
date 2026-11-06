## Changed

- **B4 子批 6：20 份 / 61 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 20 份路径行）。
  命名组 30 处（剧本解析的 scene/indoor/rest/action/dialogText、`tsKindUnion` 的 kind、
  文件名/标识符提取等，消费点同步为 `groups?.<name>`），非捕获组 31 处（只做 test 或整段替换）。
- 改动集中在 `src/lib/workflow/`（workflow-exposed-params 模式码、workflow-param-mapping 尺寸）、
  `src/lib/workshop/`（script-parse / script-parser / api-channel-shared / model-mode-contract /
  workflow-encapsulation）、`src/server/api/routers/`（setting / setting-backup / workflow-list /
  workflow-mutations）与 `tests/`（app-event-pairing / app-service-exit-contract / app-metadata /
  artifact-layout / audits-doc-references / base-check）。
- 两处测试辅助函数补显式回退（`groups?.x ?? ""`），`tsc --noEmit` 复跑通过。
- 台账：B4 行改「清账中（子批1–6：225 份 / 720 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
