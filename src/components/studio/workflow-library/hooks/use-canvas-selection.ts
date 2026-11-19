"use client";

// ── 画布预览的选中态（左列卡片 / 右列输出口，互斥）────────────────────
// 点卡片或点它那条线选中，按 ⌫ 断开、按卡片头 ↺ 恢复默认。两列**同一时刻
// 只有处被选**，否则「按 ⌫ 断的是哪一根」说不清。回调引用稳定（#4467：
// 内联箭头会让画布层的三个内容对象每帧都是新引用，Context value 随之变化，
// 三列节点的 memo 被击穿重渲）。

import { useCallback, useState } from "react";

export function useCanvasSelection() {
  const [selectedParamId, setSelectedParamId] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const selectParam = useCallback((id: string | null) => {
    setSelectedParamId(id);
    if (id !== null) {
      setSelectedOutputId(null);
    }
  }, []);
  const selectOutput = useCallback((id: string | null) => {
    setSelectedOutputId(id);
    if (id !== null) {
      setSelectedParamId(null);
    }
  }, []);
  return {
    selectOutput,
    selectParam,
    selectedOutputId,
    selectedParamId,
  };
}
