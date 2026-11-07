## Fixed

**CodeQL `js/identity-replacement`（#18 / #19，medium）**：

- `scripts/check-react-updater-purity.cjs` 的两处 `replaceAll("/", "/")` 都是恒等替换
  （空操作）。去掉这两处，`relBase` 的取值不变：绝对扫描根原样保留，相对根仍剥掉
  开头斜杠 —— 这是该文件的既有口径，不是为消警改行为。
- 该文件的行为由 `tests/check-react-updater-purity.test.ts` 覆盖，去掉空操作后全绿。
