## Fixed

- `tests/**` 的 18 份 oxfmt 存量清零（ISSUE #3227）：全量档的扫描根只有 `src` 与 `.storybook`，`IGNORE_GLOBS` 又把 `tests/**` 整类剔掉，这批存量在**任何**判决面上都不会红（#3204 清的只是 `src/**` 那 69 份）；增量两档（`--changed` / `--staged`）自 #3196 / #2979 起不再套 `IGNORE_GLOBS`，所以它们只判「本次改动带来的那批」，同样够不到这批存量。本笔 18 份全部是纯 oxfmt 重排（AST 与注释原文逐份比对 18/18 一致，零功能改动），按 §13.5.2 的 `format-migration:` 出口放行；补完后 `tests/**` 在全量档与增量两档上都是 0 命中。
