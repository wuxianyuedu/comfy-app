## Changed

- oxlint `perfectionist/sort-jsx-props` 补齐全仓面（#2893）：2 处 / 1 份，都在
  `src/components/studio/project-home/SeriesOrganizer.tsx`（#2836 带回来的）——
  `<NativeSelect>` 的 `onChange` / `value` 与 `<Button>` 的 `className` / `variant`
  按字母序重排。两处都是无副作用的取值与闭包，求值顺序变化不构成行为差异。
