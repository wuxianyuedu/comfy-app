## Fixed

- UI 基元 P41 判据把「`error` 字样」当成信封键，`catch (error)` 的实参、
  `apiErrorDetail(` 这类标识符都会命中，于是一次纯改名（`e` → `error`）就能
  把合规路由判红。现在只认信封键 `error:`（`\berror\s*:`），并补一条回归
  用例：catch 形参叫 `error`、信封里没有 `error` 键的路由不计 P41。
