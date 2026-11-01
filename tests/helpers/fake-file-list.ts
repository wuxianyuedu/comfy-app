/**
 * 构造**可迭代**的 `FileList` 假体。
 *
 * 真实 `FileList` 带 `Symbol.iterator`，生产侧会 `for…of` 或展开它；只给
 * `length` + 下标的类数组假体会当场抛 `files is not iterable`，把「夹具不全」
 * 伪装成「代码坏了」。
 */
export function fakeFileList(...files: Array<File>): FileList {
  return Object.assign([...files], {
    item: (index: number): File | null => files[index] ?? null,
  });
}
