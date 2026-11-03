## Fixed

**`#` 注释语法的两格判据终于「先剥再判」**（ISSUE #2934）：
`tests/helpers/strip-comments.ts` 加 `{ syntax: "js" | "hash" }`（默认 `js`，旧调用零变化）。

- `hash` 档只做行注释（那两种格式没有块注释语法），`#` 落在引号内仍是代码，
  默认仍只去整行注释、`trailing: true` 才连行尾一起去 —— 与 `js` 档共用同一个引号状态机。
- `tests/cross-platform-launcher.test.ts` 的爱 `#` 两份接收者改走 `hash` 档：
  `scripts/dev-launcher.ps1`（`taskkill /` 等四条反向断言）与 `src-tauri/Cargo.toml`
  （`/^windows\s*=/m` 的行首锚语义原样保留）。此前 JS 档实测等于没剥（2898 → 2898），
  注释里提一句「以前调过」就会假红，口径与机制对不上。
- 新增 `tests/strip-comments-hash-syntax.test.ts`：钉住「注释提及不红、真实调用仍红」、
  行数不漂、引号内 `#` 不动、Cargo 行首锚正反两向，以及 `js` 档回归。
