## Changed

- **零引用基元第一档三条（`tabs` / `alert` / `dropdown-menu`）接上业务，调用处那份手写的交互语义随之删除**（规范 16 §16.2.4.6 第一档 → §16.2.4.7）。这三条此前被记成「本应用没有对应场景」，复查时按**形态**（而不是按名字）找回：库内确实有三套自绘外壳。

  - **`tabs`**：`workflow-library` 详情面板三页签（自绘 `TabButton` 删除）改 `ui/tabs` 的 `line` 变体；`DetailBody` 由「按 `activeTab` 分支」改成「每个页签各一个 `TabsContent` 面板」，base-ui 只挂载当前面板。指示条的 token 渐变收进 `globals.css` 的 `.detail-tab-trigger::after`。
  - **`alert`**：六处通知块接上基元 —— 登录页 `notice`、训练页「未配置训练后端」横幅、设置页「读取失败」提示条、节点 `ErrorPanel` 参数提示、工坊 `CharacterPortraitStudio` / `ShotStudio` / `VideoStudio` 三处行内错误行。`ui/alert` 补出 `warning` / `info` / `success` / `danger` 四支语义变体（原先只有 `default` / `destructive`，而视图里全是语义色），颜色收成一个出口。
  - **`dropdown-menu`**：画布右键菜单 `CanvasContextMenu` 与项目切换器 `ProjectSwitcher` 换基元 —— 自绘遮罩、`fixed` / `absolute` 手定位、手写 Esc 与外点关闭全部删除（只换容器会留下两套 Esc / 两套外点关闭同时生效）。

## Fixed

- **工坊三处行内错误行的危险色在深色主题下与文字糊在一起**：`CharacterPortraitStudio` / `ShotStudio` / `VideoStudio.parts` 写死 `bg-red-100 text-red-800 dark:text-red-300` —— 深色下仍是浅红底配浅红字。改走 `ui/alert` 的 `danger` 变体后底色 / 文字档都由 token 按主题取，两态都清晰。同时消掉三处逐字相同的写死配色。

## Docs

- 规范 16 新增 **§16.2.4.7**（第一档三条的落点表 + 五条可照抄的口径 + 本批未动的那一批及其理由），并在 §16.2.4.6 标出第一档已接。
- `tests/ui-primitives-coverage.test.ts` 的 `REQUIRED_CONSUMERS` 登记 `tabs` / `alert` / `dropdown-menu`（已经用上的不许掉回 0）；接线另有四份契约测试。
