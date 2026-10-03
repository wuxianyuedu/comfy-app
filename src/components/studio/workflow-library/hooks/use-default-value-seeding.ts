"use client";

/* ── 输入值状态 + 模式默认值播种 ──
 *
 * 「画布样式预览」的表单值只有一个所有者，就是这里：workflow 或**生效模式**
 * 变化时，用该模式的两级默认值（模式覆盖 -> 作者 value -> 图内 defaultValue）
 * 回填表单，使预览初始即展示该模式下配置的默认值（模式 chip 上显示的就是它）。
 * io 尚未就绪时跳过，用户后续可自由覆盖。
 */
import { useEffect, useRef, useState } from "react";

import {
  defaultInputValues,
  mergeRefreshedDefaults,
  type WorkflowIOMap,
} from "../../workflow-io";

export function useDefaultValueSeeding(params: {
  workflowId: string;
  workflowIO: WorkflowIOMap | null;
  effectiveMode: string | null;
}) {
  const { workflowId, workflowIO, effectiveMode } = params;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const seedRef = useRef<string | null>(null);
  /* 上一次播种下去的默认值表 —— 判断「用户有没有改过这一格」的基线（见
   *  mergeRefreshedDefaults）。它必须始终是「播种时的那一份」，所以只在播种
   * 处写入，其余时候连引用都不能动。 */
  const baselineRef = useRef<Record<string, unknown>>({});
  /* 播种键同时含 workflowId 与生效模式：换工作流 / 换模式都会落到下面的
   * 「整表重播」分支。这一步是必须的——若只按 mode 判定，上一个工作流的
   * 用户覆盖值会被当成新工作流的覆盖值保留下来（ioKey 恰好同名时）。 */
  const activeSeedKey = `${workflowId ?? ""}|${effectiveMode ?? ""}`;
  useEffect(() => {
    if (!workflowIO) return;
    const fresh = defaultInputValues(workflowIO, effectiveMode);
    if (seedRef.current === activeSeedKey) {
      /* 同一个工作流 + 同一个模式，IO 变了 = 作者在编辑器里改了默认值。
       *  此时不能整表覆盖（会吃掉用户已填的覆盖值），只把「仍等于旧默认值」
       *  的那一格刷新到新默认值；用户改过的格子原样保留。 */
      setValues((current) => {
        const merged = mergeRefreshedDefaults(
          current,
          baselineRef.current,
          fresh,
        );
        return merged ?? current;
      });
      baselineRef.current = fresh;
      return;
    }
    /* 首次播种 / 换工作流 / 换模式：整表采用新默认值，清掉上一份残留。 */
    seedRef.current = activeSeedKey;
    baselineRef.current = fresh;
    setValues(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 workflow/模式变化时整表播种，IO 变化走上面的保覆盖刷新
  }, [workflowIO, workflowId, effectiveMode]);

  return { values, setValues };
}
