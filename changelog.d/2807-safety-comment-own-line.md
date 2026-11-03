## Changed

`src/lib/media/size-preset-store.ts` 里最后 3 处「`/* SAFETY: … */` 与断言同行」
的形态改为独行（注释单独一行、断言另起一行），与全仓既有口径对齐（#2807）。
`SAFETY + 同行 as 断言` 全仓实测从 605（10-31 旧数）→ 0。
