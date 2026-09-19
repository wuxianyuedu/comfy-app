"use client";

// ── LoRA 训练工作室：业务逻辑层（规范 17 §17.2 第②层）──────────────────────
// 承载底模列表、任务轮询、表单状态与校验、数据集上传与任务创建/取消。
// TrainingStudio 视图只消费本 hook 返回的 controller，不再出现 vanillaApi / fetch。
//
// 路由跳转（next/navigation）留在视图层：它是渲染框架的导航副作用，
// 搬进 hook 只会让 hook 依赖 App Router 上下文、更难单测。

import { useCallback, useEffect, useMemo, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { uploadDatasetImage } from "~/lib/media/dataset-upload-client";
import { errorMessage } from "~/lib/error-message";
import { vanillaApi } from "~/trpc/vanilla";

import {
  DEFAULTS,
  JOBS_POLL_MS,
  type DatasetItem,
  type ModelOpt,
  type TrainJob,
  type TrainJobInput,
  fillBlankCaptions,
  pickActiveJob,
  toDatasetPayload,
  validateTrainForm,
} from "../training-studio-config";

export interface TrainingStudioController {
  /* 后端与底模 */
  checkpoints: ModelOpt[];
  backendConfigured: boolean;
  jobs: TrainJob[];
  /* 表单 */
  form: TrainJobInput;
  setName: (value: string) => void;
  setBaseModel: (value: string) => void;
  setTriggerWord: (value: string) => void;
  setClassWord: (value: string) => void;
  setResolution: (value: number) => void;
  setSteps: (value: number) => void;
  setBatchSize: (value: number) => void;
  setLearningRate: (value: number) => void;
  setRankDim: (value: number) => void;
  setNetworkAlpha: (value: number) => void;
  setOptimizer: (value: string) => void;
  setScheduler: (value: string) => void;
  setSeed: (value: number) => void;
  /* 数据集 */
  dataset: DatasetItem[];
  setDataset: React.Dispatch<React.SetStateAction<DatasetItem[]>>;
  uploading: boolean;
  /** 上传失败的错误文案；null 表示无错误。 */
  error: string | null;
  /* 状态位 */
  submitting: boolean;
  /** 当前监控的任务（进行中 > 排队中 > 首条）。 */
  activeJob: TrainJob | null;
  /* 动作 */
  upload: (files: FileList | null) => Promise<void>;
  fillBlank: () => void;
  submit: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
}

export function useTrainingStudio(): TrainingStudioController {
  const [checkpoints, setCheckpoints] = useState<ModelOpt[]>([]);
  const [backendConfigured, setBackendConfigured] = useState(true);
  const [jobs, setJobs] = useState<TrainJob[]>([]);

  const [name, setName] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [classWord, setClassWord] = useState("");
  const [dataset, setDataset] = useState<DatasetItem[]>([]);
  const [resolution, setResolution] = useState<number>(DEFAULTS.resolution);
  const [steps, setSteps] = useState<number>(DEFAULTS.steps);
  const [batchSize, setBatchSize] = useState<number>(DEFAULTS.batchSize);
  const [learningRate, setLearningRate] = useState<number>(
    DEFAULTS.learningRate,
  );
  const [rankDim, setRankDim] = useState<number>(DEFAULTS.rankDim);
  const [networkAlpha, setNetworkAlpha] = useState<number>(
    DEFAULTS.networkAlpha,
  );
  const [optimizer, setOptimizer] = useState<string>(DEFAULTS.optimizer);
  const [scheduler, setScheduler] = useState<string>(DEFAULTS.scheduler);
  const [seed, setSeed] = useState<number>(DEFAULTS.seed);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── 底模列表 ── */
  const loadModels = useCallback(() => {
    void vanillaApi.model.list
      .query({ type: "CHECKPOINT" })
      .then((data) =>
        setCheckpoints((data.models ?? []) as unknown as ModelOpt[]),
      )
      .catch(() => {
        /* 底模拉取失败静默忽略：下拉只是空，不阻塞训练 */
      });
  }, []);

  /* ── 任务列表（轮询）── */
  const loadJobs = useCallback(() => {
    vanillaApi.train.list
      .query()
      .then((data) => {
        setJobs((data.jobs ?? []) as unknown as TrainJob[]);
        setBackendConfigured(data.backendConfigured ?? false);
      })
      .catch(() => {
        /* 轮询失败静默忽略，下一次 interval 会重试 */
      });
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  /* 任务列表轮询：挂载即先拉一次、之后每 `JOBS_POLL_MS` 一次，切后台暂停
   * （规范 16 §16.2.4.15）。此前自己 `setInterval` —— 不会立刻拉一次，且
   * 后台标签页里空转。 */
  useInterval(loadJobs, { ms: JOBS_POLL_MS });

  /* ── 数据集上传：逐张串行，失败即停并把错误抛给用户 ── */
  const upload = useCallback(async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        const name = await uploadDatasetImage(file);
        setDataset((prev) => [...prev, { name, caption: "" }]);
      }
    } catch (e) {
      setError(errorMessage(e, "上传失败"));
    } finally {
      setUploading(false);
    }
  }, []);

  const fillBlank = useCallback(() => {
    setDataset((prev) => fillBlankCaptions(prev, triggerWord));
  }, [triggerWord]);

  const submit = useCallback(async () => {
    setError(null);
    const payload: TrainJobInput = {
      name,
      baseModel,
      triggerWord,
      classWord: classWord.trim() || undefined,
      datasetImages: toDatasetPayload(dataset),
      resolution,
      steps,
      batchSize,
      learningRate,
      rankDim,
      networkAlpha,
      optimizer,
      scheduler,
      seed,
    };
    const invalid = validateTrainForm({
      ...payload,
      triggerWord: payload.triggerWord,
    });
    if (invalid) {
      setError(invalid);
      return;
    }

    setSubmitting(true);
    try {
      await vanillaApi.train.create.mutate({
        name: payload.name.trim(),
        baseModel: payload.baseModel,
        triggerWord: payload.triggerWord.trim(),
        classWord: payload.classWord,
        datasetImages: payload.datasetImages,
        resolution,
        steps,
        batchSize,
        learningRate,
        rankDim,
        networkAlpha,
        optimizer,
        scheduler,
        seed,
      });
      // 提交成功后重置表单（原组件行为：保留底模、分辨率等配置，只清名称/触发词/数据集）
      setName("");
      setTriggerWord("");
      setClassWord("");
      setDataset([]);
      setSteps(DEFAULTS.steps);
      setRankDim(DEFAULTS.rankDim);
      setNetworkAlpha(DEFAULTS.networkAlpha);
      loadJobs();
    } catch (e) {
      setError(errorMessage(e, "创建失败"));
    } finally {
      setSubmitting(false);
    }
  }, [
    name,
    baseModel,
    triggerWord,
    classWord,
    dataset,
    resolution,
    steps,
    batchSize,
    learningRate,
    rankDim,
    networkAlpha,
    optimizer,
    scheduler,
    seed,
    loadJobs,
  ]);

  const cancelJob = useCallback(
    async (id: string) => {
      try {
        await vanillaApi.train.cancel.mutate({ id });
        loadJobs();
      } catch (e) {
        setError(errorMessage(e, "取消失败"));
      }
    },
    [loadJobs],
  );

  const form = useMemo<TrainJobInput>(
    () => ({
      name,
      baseModel,
      triggerWord,
      classWord: classWord.trim() || undefined,
      datasetImages: toDatasetPayload(dataset),
      resolution,
      steps,
      batchSize,
      learningRate,
      rankDim,
      networkAlpha,
      optimizer,
      scheduler,
      seed,
    }),
    [
      name,
      baseModel,
      triggerWord,
      classWord,
      dataset,
      resolution,
      steps,
      batchSize,
      learningRate,
      rankDim,
      networkAlpha,
      optimizer,
      scheduler,
      seed,
    ],
  );

  const activeJob = useMemo(() => pickActiveJob(jobs), [jobs]);

  return {
    checkpoints,
    backendConfigured,
    jobs,
    form,
    setName,
    setBaseModel,
    setTriggerWord,
    setClassWord,
    setResolution,
    setSteps,
    setBatchSize,
    setLearningRate,
    setRankDim,
    setNetworkAlpha,
    setOptimizer,
    setScheduler,
    setSeed,
    dataset,
    setDataset,
    uploading,
    error,
    submitting,
    activeJob,
    upload,
    fillBlank,
    submit,
    cancelJob,
  };
}
