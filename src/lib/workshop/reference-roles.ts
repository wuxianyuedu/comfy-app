/**
 * 参考图职责化（ISSUE #5298）：每张参考图只负责一件事（身份 / 质感 / 背景 / 服装 / 道具），
 * 借鉴 Higgsfield「每张参考只有一个任务，模型才有具体视觉目标」。
 * 纯函数：外来职责逐项收窄，缺项回落 identity；只产出可读对照与提示词注解，不碰 IO。
 */
export const REFERENCE_ROLES = ["background", "identity", "prop", "texture", "wardrobe"] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];
export const MAX_REFERENCE_IMAGES = 16;

/** 外来职责 → 受控职责；认不出一律 identity（老草稿没有这个字段，自动归位）。 */
export function referenceRoleOf(raw: unknown): ReferenceRole {
  return raw === "background" || raw === "texture" || raw === "wardrobe" || raw === "prop"
    ? raw
    : "identity";
}

/** 与图片槽逐项对齐的职责列表：缺项补 identity，多余截断。 */
export function normalizeReferenceRoles(raw: unknown, count: number): Array<ReferenceRole> {
  const entries = Array.isArray(raw) ? raw : [];
  const roles: Array<ReferenceRole> = [];
  for (let i = 0; i < Math.min(count, MAX_REFERENCE_IMAGES); i++) {
    roles.push(referenceRoleOf(entries[i]));
  }
  return roles;
}

/**
 * 「槽位 ↔ 职责 ↔ 图片编号」的可读对照，写进提示词注解/日志，供人核对上传槽位是否错位。
 */
export function referenceRoleAnnotation(roles: ReadonlyArray<ReferenceRole>): string {
  if (roles.length === 0) {
    return "";
  }
  return roles.map((role, index) => `@image_${index + 1}=${role}`).join(", ");
}

/** 把镜头参考图与角色表演参考合成一条带职责的列表（身份在前，其余按槽位顺序）。 */
export function orderedReferences(opts: {
  performance?: ReadonlyArray<string>;
  shotImages?: ReadonlyArray<string>;
  shotRoles?: ReadonlyArray<ReferenceRole>;
}): Array<{ role: ReferenceRole; url: string }> {
  const result: Array<{ role: ReferenceRole; url: string }> = [];
  for (const url of opts.performance ?? []) {
    if (url !== "") {
      result.push({ role: "identity", url });
    }
  }
  const images = opts.shotImages ?? [];
  for (let i = 0; i < Math.min(images.length, MAX_REFERENCE_IMAGES - result.length); i++) {
    const url = images[i] ?? "";
    if (url !== "") {
      result.push({ role: opts.shotRoles?.[i] ?? "identity", url });
    }
  }
  return result;
}
