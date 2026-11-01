## Fixed

`tests/scripts-typecheck-ratchet.test.ts` 的 `write()` 只收相对夹具根的路径，而「面收缩」那一条传了绝对路径 —— `join(fixture, rel)` 把夹具根拼两遍，Windows 上直接 `ENOENT`（POSIX 的 `mkdir -p` 会把拼坏的路径真建出来，所以本地恒绿、只有 CI 红）。修掉那一处，并让 `write()` 遇到绝对路径当场抛，别再靠人眼盯调用点（#2974）。
