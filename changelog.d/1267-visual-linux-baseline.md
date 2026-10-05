## Added

- **恢复 linux 档像素基线（ISSUE #1267）**：`#6538809` 把 `-linux.png` 两张删掉、把
  `SUPPORTED_PLATFORMS` 收成 `win32` 之后，像素层在 Linux 容器 / 类 CI 环境上「一跑就红、
  且红指向的动作是重录」。本次按 §11.8 定下的姿势恢复：**用同一份 spec（`e2e/visual/login.visual.spec.ts`）
  在该档 `--update-snapshots` 重录**出 `login-{desktop,mobile}-chromium-linux.png` 两张成套 PNG，
  并**同批**把 `linux` 加回 `tests/visual-baseline-pairing.test.ts` 的 `SUPPORTED_PLATFORMS` ——
  只录基线不登记 = 被孤儿判据点名，只登记不录基线 = 那一档一跑就红，两种半套都比「没有那一档」更费人。
- **linux 档的 webServer 口径写进文档与判据注释**：该档按 `CI=true` ⇒ `pnpm start`（需先
  `pnpm build`）录制，实测同一命令连跑两次零差异。**基线是按 webServer 口径录的** —— `pnpm dev`
  与 `pnpm start` 的像素互不相同（dev 指示器那块），在某一档跑像素时 `CI` 的真假要与该档录制时一致。

## Fixed

- **修掉一处「文档写着能跑、实际没遮住」的说法**：§11.8 原写「dev 指示器按存在与否追加 mask，
  这样 `pnpm dev` 与 `pnpm start` 两种 webServer 都能跑」—— 实测**遮不住**：Next 把那个角标挂在
  `nextjs-portal` 的 shadow root 里，宿主元素 `position` 不占位、`boundingBox()` 是 `0×0`，
  而 Playwright 的 `mask` 按 bounding box 画，0×0 等于什么都没遮（win32 基线左下角仍留着
  「N 1 Issue」角标可证）。文档与 spec 注释据此改为「不在 dev 口径下录基线」的口径，
  并记下「真要让它成为 mask 能遮住的元素、得连同 win32 基线一起重录」这个前提。
