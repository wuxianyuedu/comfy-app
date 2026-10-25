## Fixed

壳门禁探不到 `CARGO_HOME` 下的 cargo —— 而它在盘上（PR #2283 的平台现场）：

- `G:` 是 subst 出来的盘符，Node 的 `fs` 走 Win32 long-path 前缀、而 subst 映射是
  **每登录会话**的 ⇒ 同一份 `G:\.cargo\bin\cargo.exe` 对 `fs.existsSync` 不存在、
  对 `Get-Command` 存在。旧判据只做 `existsSync(<dir>/cargo.exe)`，于是「装好了、
  探不到」，那一整格按「没跑起来」收，红的原因与代码无关。
- 回退面的每一处改走 `probeCargoIn()`：先 `existsSync`，不命中再看目录
  （`readdirSync`）——「目录里有这个名字而 `fs` 判它不在」记成 `unreadable`
  并把目录读数写进取证，既不冒充「盘上没有这个文件」，也不假装命中（那会拿一个
  真的跑不起来的路径去 `cargo test`）。
- `absent` / `empty` / `unreadable` 三档分开：目录不在、目录在而里面没有那个名字、
  看得见名字而 `fs` 判它不存在 —— 三者的下一动作完全不同（查 `CARGO_HOME` 的值 /
  装工具链 / 修判据的路径形态），而它们此前逐字同形。
