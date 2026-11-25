import { useCallback, useRef, useState } from "react";

import type { ModelTestResult } from "./hooks/use-model-test-generate";
import type { ModelTestKind, ModelTestValues } from "./model-test-config";

export type ModelTestRun = {
  durationMs: number;
  endpoint?: string;
  error: string | null;
  id: string;
  kind: ModelTestKind;
  mode: string;
  model: string;
  referenceImages: Array<string>;
  result: ModelTestResult;
  sessionKey: string;
  startedAt: number;
  status: "cancelled" | "failed" | "succeeded";
  values: ModelTestValues;
};

export type ModelTestRunInput = Omit<ModelTestRun, "id">;

export function classifyModelTestError(error: string | null): string {
  if (error === null) {
    return "未知";
  }
  if (/取消|abort/i.test(error)) {
    return "已取消";
  }
  if (/401|403|密钥|授权|api key/i.test(error)) {
    return "鉴权失败";
  }
  if (/429|rate.?limit|额度|配额/i.test(error)) {
    return "限流或额度";
  }
  if (/超时|timeout|timed out/i.test(error)) {
    return "请求超时";
  }
  if (/连不上|fetch failed|ECONNREFUSED|ECONNRESET|网络/i.test(error)) {
    return "连接失败";
  }
  if (/500|502|503|504|上游|服务器/i.test(error)) {
    return "上游故障";
  }
  if (/请填写|不存在|BAD_REQUEST|参数/i.test(error)) {
    return "参数或配置";
  }
  return "执行失败";
}

export function useModelTestRuns() {
  const [runs, setRuns] = useState<Array<ModelTestRun>>([]);
  const sequence = useRef(0);
  const recordRun = useCallback((input: ModelTestRunInput) => {
    sequence.current += 1;
    const run: ModelTestRun = {
      ...input,
      id: `${String(input.startedAt)}-${String(sequence.current)}`,
    };
    setRuns((previous) => {
      const counts = new Map<string, number>();
      return [run, ...previous].filter((item) => {
        const count = (counts.get(item.sessionKey) ?? 0) + 1;
        counts.set(item.sessionKey, count);
        return count <= 30;
      });
    });
  }, []);
  const clearRuns = useCallback(() => {
    setRuns([]);
  }, []);
  return { clearRuns, recordRun, runs };
}
