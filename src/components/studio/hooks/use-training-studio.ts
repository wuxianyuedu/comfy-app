"use client";

// ── LoRA 训练工作室：业务逻辑层（规范 17 §17.2 第②层）──────────────────────
// 承载底模列表、任务轮询、表单状态与校验、数据集上传与任务创建/取消。
// TrainingStudio 视图只消费本 hook 返回的 controller，不再出现 vanillaApi / fetch。
//
// 路由跳转（next/navigation）留在视图层：它是渲染框架的导航副作用，
// 搬进 hook 只会让 hook 依赖 App Router 上下文、更难单测。

import { useCallback, useEffect, useMemo, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import {
  useItemErrors,
  type ItemErrors,
} from "~/components/ui/use-item-errors";
import { uploadDatasetImage } from "~/lib/media/dataset-upload-client";
import { runAsyncAction } from "~/lib/async-action";
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
  type TrainFormErrors,
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
  /**
   * 按条目挂的错误（规范 16 §16.2.4.33）。
   *
   * 收口前是一句 `useState<string | null>` —— 「最近一次操作的草稿」：
   * 取消某个任务失败后再提交一次表单，那条任务的错误就被盖掉了。
   * 现在三个动作各挂各的 scope：上传 → `null`（整块）、提交 → `null`、
   * 取消 → **任务 id**（那一行的「取消」按不动的原因就写在它旁边）。
   */
  errors: ItemErrors;
  /** 字段级校验错误（逐行渲染在对应控件下方）。 */
  fieldErrors: TrainFormErrors;
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
  /* 取消错误的 scope 是任务 id：任务不在列表里（已完成 / 被清掉）时，
   * 它挂着的错误随之消失。 */
  const errors = useItemErrors(jobs.map((job) => job.id));
  /* 字段级校验错误（`FormField` 逐行渲染）。与 `error` 分工明确：
   * 前者是**这个字段填错了**，后者是上传 / 网络的非字段错误（规范 16 §16.2.4.26）。 */
  const [fieldErrors, setFieldErrors] = useState<TrainFormErrors>({});

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
  const upload = useCallback(
    async (files: FileList | null) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      setUploading(true);
      errors.clear(null);
      /* 行内错误条是这块唯一的反馈通道；成功静默（缩略图出现即结果）。
       * 出口给「失败文案走 `errorMessage`」这一半。 */
      await runAsyncAction(
        async () => {
          for (const file of list) {
            const name = await uploadDatasetImage(file);
            setDataset((prev) => [...prev, { name, caption: "" }]);
          }
        },
        {
          report: errors.report(null),
          failureText: "上传失败",
        },
      );
      setUploading(false);
    },
    [errors],
  );

  const fillBlank = useCallback(() => {
    setDataset((prev) => fillBlankCaptions(prev, triggerWord));
  }, [triggerWord]);

  const submit = useCallback(async () => {
    errors.clear(null);
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
    if (Object.keys(invalid).length > 0) {
      /* 逐字段标红，而不是在提交按钮上方报一句 —— 用户据此知道该改哪一行。 */
      setFieldErrors(invalid);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    await runAsyncAction(
      async () => {
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
      },
      {
        report: errors.report(null),
        failureText: "创建失败",
      },
    );
    setSubmitting(false);
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
    errors,
  ]);

  const cancelJob = useCallback(
    async (id: string) => {
      await runAsyncAction(
        async () => {
          await vanillaApi.train.cancel.mutate({ id });
          loadJobs();
        },
        {
          /* 失败挂在**那个任务**上：用户点的是哪一行的「取消」，
           * 提示就出现在哪一行旁边。 */
          report: errors.report(id),
          failureText: "取消失败",
        },
      );
    },
    [loadJobs, errors],
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
    errors,
    fieldErrors,
    submitting,
    activeJob,
    upload,
    fillBlank,
    submit,
    cancelJob,
  };
}
