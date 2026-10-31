/**
 * 版本目录名的比较（`12.4.1` 排在 `10.34.5` 前面）。
 *
 * 为什么单独一份：`executable-resolve.ts` 里那两个「找 pnpm 包真身」的函数
 * 要按版本挑落点（corepack 的 `…/v1/pnpm/<ver>/` 一族），这一段是纯字符串
 * 比较、没有 IO、也不属于「怎么起这个命令」那条判据。文件在 oxlint `curly`
 * 那批机械改写后越过文件长度硬闸（规范 §12.6），按职责拆出来是这一刀唯一的动机。
 *
 * 非数字段按字符串退让（`1.0.0-beta` 这类），两侧都解析得出数字才按数值降序。
 */
export function compareVersionDesc(a: string, b: string): number {
  const [pa, pb] = [a.split("."), b.split(".")];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const [na, nb] = [Number.parseInt(pa[i] ?? "0", 10), Number.parseInt(pb[i] ?? "0", 10)];
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = String(pa[i] ?? "").localeCompare(String(pb[i] ?? ""));
      if (cmp !== 0) {
        return cmp;
      }
      continue;
    }
    if (na !== nb) {
      return nb - na;
    }
  }
  return 0;
}
