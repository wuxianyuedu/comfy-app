## Fixed

- **`@theme` token 清单快照补上 `--gradient-brand`**（`tests/__snapshots__/theme-tokens.css-theme-surface.txt`）。
  这不是本次改动引入的：`--gradient-brand` 随「品牌渐变收口」那一批进了 `globals.css`，
  但**没有同批重录这份文件快照** —— 与上一轮那四颗 `--color-glow-*` 同族（加 token
  不同批重录快照），是同一处判据第二次被同一类改动踩到。按原本的处置重录（`-u`），
  实测差异逐行核对过：只有新增那一行。
