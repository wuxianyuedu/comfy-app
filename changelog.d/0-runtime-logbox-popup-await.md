## Fixed

- **`RuntimeLogBox` 的会话下拉用例改成「等弹层出现」**（`src/app/(main)/settings/components/RuntimeLogBox.test.tsx`）：
  P76 把裸 `<select>` 换成 `ui/select-menu` 的 combobox 后，用例仍是「点一下 → 立刻
  同步 `getAllByRole("option")`」。Base UI 的弹层走 portal 异步挂载，空载的事件循环里
  恰好来得及，全量并行时被饿到查不到（红在 `Unable to find an accessible element with
the role "option"`）。现按 `findAllByRole` 等到元素出现，锁的口径不变。
