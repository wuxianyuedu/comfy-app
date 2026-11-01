## Changed

- oxlint `react/jsx-boolean-value` 全仓清零（#2775）：2 处 / 2 份。
  `<WidgetValueChip value={true}>` → `value`、`disabled={true}` → `disabled`（JSX 布尔简写），
  等价改写，无运行期变化。
