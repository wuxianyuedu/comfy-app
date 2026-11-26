"use client";

/**
 * 库页通用的多选态（角色 / 风格 / 脸）：纯 state，无网络 / 无 DOM，
 * 因此归 components 的 hooks 层（规范 17 §17.2 第②层），三个 feature 共用一份。
 * 全选收的是「当前可见 id 列表」而不是组件自己记的候选，避免搜索换页后
 * 把已经过滤掉的条目也勾上。
 */
import { useCallback, useMemo, useState } from "react";

export function useLibrarySelection<T extends string>(initial: ReadonlyArray<T> = []) {
  const [selected, setSelected] = useState<Array<T>>(() => [...initial]);

  const toggle = useCallback((value: T) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  }, []);

  const add = useCallback((value: T) => {
    setSelected((prev) => (prev.includes(value) ? prev : [...prev, value]));
  }, []);

  const clear = useCallback(() => {
    setSelected([]);
  }, []);

  const selectAll = useCallback((values: ReadonlyArray<T>) => {
    setSelected([...values]);
  }, []);

  const isSelected = useCallback((value: T) => selected.includes(value), [selected]);

  return useMemo(
    () => ({ add, clear, isSelected, selectAll, selected, toggle }),
    [add, clear, isSelected, selectAll, selected, toggle],
  );
}
