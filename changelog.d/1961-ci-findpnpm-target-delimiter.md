## Fixed

- **`findPnpm()` 按宿主的 `path.delimiter` 切 PATH**（ISSUE #1961，跨平台盲区）：
  它的 `platform` 是**可注入**的（单测正是在 POSIX 上判 Windows 的形态），而
  `path.delimiter` 是**跑这段的宿主**的分隔符 —— POSIX 上拿 `:` 去切一串 `;` 分隔的
  Windows PATH，会把整串当成**一条**目录，每个候选都拼成不存在的路径、
  判据静默答「pnpm 不可用」。现场那台机的 PATH 是几十条 `;` 分隔的条目，
  所以这不是假想形态。

  改成按**目标平台**的分隔符切（`platform === "win32" ? ";" : ":"`）——
  与同批 `pnpmForensics()` / `ci-toolchain-python.mjs` 的 `pathDrives` 同口径
  （后者早就记过这一格：「不要按分隔符切」，它按 `;` 直接匹配）。

  判据（`tests/ci-toolchain-selfcheck.test.ts`）造一个「真正要用的 pnpm 在**第二条**
  PATH 条目上」的注入现场 —— 切错分隔符就整串命中不了，当场点名。
  注入的 `isFile` 把分隔符归一（`findPnpm` 用宿主 `path.join` 拼，POSIX 上给 `/`），
  与同文件「大小写按 NTFS 不敏感处理」是同一条理由：判据不依赖宿主的书写形态。
  反向复算：改回 `path.delimiter`，当场红。
