## Fixed

- **`src/lib` 里三处「`filter` 返回 boolean 却指望它窄化元素类型」的非空断言**：
  写 `.filter((x) => 判据)` 之后 `.map` 里对同一判据命中的字段仍要 `x.field!`，
  是把「同一件事用两次」的口头约定塞进类型系统 —— 改 filter 判据忘了同步 `!`
  （或反过来）就分叉。三处一并换成显式的类型谓词，把判据在类型层落住：
  `src/lib/media/task-images-client.ts` 的 `hasLocalPath`
  （`localPath` 必须是 string）、
  `src/lib/comfyui/trainer.ts` 的 `hasNonEmptyCaption`
  （`caption` 去空白非空）、
  `src/lib/comfyui/instance-port.ts` 的 `withPort(pid, source, via)`
  （原来跨函数边界窄化丢失，靠 `lookup.pid!` 兜住；改成直收已窄化好的 pid 数字，
  顺带把 caller 循环里的 `lookups[i]!` / `candidates[i]!` 换成
  `noUncheckedIndexedAccess` 下 `!candidate || !lookup` 的 continue 守卫）。
  行为、加解密 / 相册翻页 / 端口探测语义不变，只收口类型契约；
  `instance-port.ts` 同时去掉了对 `proc-detect` 的 `type PidLookup` 依赖。
