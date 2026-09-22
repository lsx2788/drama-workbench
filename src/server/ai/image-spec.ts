import { z } from "zod";
import type { StudioService } from "../studio-service";
import { ensure } from "../errors";
import { isCharacterBasis } from "../../domain/character-basis";

export const imagePurpose = z.enum([
  "单图",
  "角色正面图",
  "穿衣首样",
  "穿衣组合",
  "角色基础图",
  "角色三视图",
  "面部特写",
  "局部特写",
  "服装图",
  "动作参考",
]);
export type ImageSpec = {
  purpose: z.infer<typeof imagePurpose>;
  basisTaskId?: string;
  category: string;
  referenceFileIds?: string[];
};

/** One task has one image purpose. Expansion is gated by an accepted visual sample. */
export function bindImageSpec(
  service: StudioService,
  p: string,
  taskId: string,
  spec: ImageSpec,
) {
  const project = service.project(p),
    task = project.tasks[taskId];
  ensure(
    task && ["assets", "frames"].includes(task.kind),
    "只有资产制作和画面制作节点可以出图",
  );
  const existing = service.db.one<{
    purpose: string;
    basis_task_id: string | null;
  }>(
    "SELECT * FROM image_task_specs WHERE project_id=? AND task_id=?",
    p,
    taskId,
  );
  if (existing)
    ensure(
      existing.purpose === spec.purpose &&
        (existing.basis_task_id ?? undefined) === spec.basisTaskId,
      "本任务出图用途或首样基准已确定；不同用途请分别创建图片任务",
    );
  if (task.kind === "assets" && spec.category === "人物")
    ensure(
      spec.purpose !== "单图",
      "角色图片需指定用途：先做白色基础打底服的角色正面图，确认人物后出三视图，再制作独立服装和穿衣组合",
    );
  if (
    [
      "角色正面图",
      "穿衣首样",
      "穿衣组合",
      "角色基础图",
      "角色三视图",
      "面部特写",
    ].includes(spec.purpose)
  )
    ensure(spec.category === "人物", "角色设定图片应归入人物资产");
  const expansion =
    spec.purpose !== "单图" &&
    !isCharacterBasis(spec.purpose) &&
    !(spec.purpose === "局部特写" && spec.category !== "人物");
  if (expansion)
    ensure(
      spec.basisTaskId,
      "补充图片必须关联已验收的角色正面图定稿基准，不能在首样通过前扩展",
    );
  if (spec.purpose === "角色正面图")
    ensure(
      !spec.basisTaskId,
      "角色正面图是定稿基准，不附属于另一个首样；已有适配角色应复用其原基准",
    );
  let files: ReturnType<StudioService["outputFiles"]> = [];
  if (spec.basisTaskId) {
    ensure(spec.basisTaskId !== taskId, "图片任务不能引用自身作为首样");
    const basis = project.tasks[spec.basisTaskId];
    ensure(
      basis?.delivery === "approved" && basis.assetCategory === "人物",
      "角色首样必须是本剧本已由总控验收的人物图片",
    );
    const basisSpec = service.db.one<{ purpose: string }>(
      "SELECT purpose FROM image_task_specs WHERE project_id=? AND task_id=?",
      p,
      basis.id,
    );
    ensure(
      !basisSpec || isCharacterBasis(basisSpec.purpose),
      "请引用已验收的角色正面图基准（已有穿衣首样可兼容复用），不能将补充视图当作首样",
    );
    files = service
      .outputFiles(p, basis.id, basis.revision)
      .filter((f) => f.mime.startsWith("image/"));
    ensure(files.length, "首样尚无实际图片，不能只依据文字扩展");
    if (
      basisSpec?.purpose === "角色正面图" &&
      ["服装图", "穿衣组合"].includes(spec.purpose)
    ) {
      const turnaround = Object.values(project.tasks).find(
        (t) =>
          t.imageSpec?.purpose === "角色三视图" &&
          t.imageSpec.basisTaskId === basis.id &&
          t.delivery === "approved" &&
          !t.retirement &&
          project.assets.some(
            (a) =>
              a.taskId === t.id &&
              a.files?.some((f) => !f.trashed && f.type.startsWith("image/")),
          ),
      );
      ensure(
        turnaround,
        "先完成并验收同一角色的三视图，再选择制作服装和穿衣组合",
      );
    }
  }
  if (spec.purpose === "穿衣组合") {
    const references = (spec.referenceFileIds ?? [])
      .flatMap((fileId) =>
        service.db.all<{
          task_id: string;
          output_revision: number;
          purpose: string;
          basis_task_id: string | null;
        }>(
          `SELECT a.task_id,a.output_revision,s.purpose,s.basis_task_id
         FROM assets a JOIN output_files f ON f.project_id=a.project_id AND f.task_id=a.task_id AND f.revision=a.output_revision
         JOIN image_task_specs s ON s.project_id=a.project_id AND s.task_id=a.task_id
         JOIN files media ON media.id=f.file_id
         WHERE a.project_id=? AND f.file_id=? AND media.mime LIKE 'image/%'
         AND NOT EXISTS (SELECT 1 FROM image_trash b WHERE b.file_id=media.id)`,
          p,
          fileId,
        ),
      )
      .filter(
        (ref) =>
          project.tasks[ref.task_id]?.delivery === "approved" &&
          project.tasks[ref.task_id]?.revision === ref.output_revision,
      );
    ensure(
      references.some(
        (ref) =>
          ["角色基础图", "角色三视图"].includes(ref.purpose) &&
          ref.basis_task_id === spec.basisTaskId,
      ),
      "穿衣组合必须引用同一角色已验收的白色素衣基础图或三视图，不能只用穿衣首样",
    );
    ensure(
      references.some((ref) => ref.purpose === "服装图"),
      "穿衣组合必须同时引用已验收的独立服装图",
    );
  }
  if (!existing) {
    ensure(task.delivery !== "approved", "已验收任务不能改写出图用途");
    service.db.run(
      "INSERT INTO image_task_specs VALUES(?,?,?,?)",
      p,
      taskId,
      spec.purpose,
      spec.basisTaskId ?? null,
    );
    if (spec.basisTaskId)
      service.db.run(
        "INSERT OR IGNORE INTO dependencies VALUES(?,?,?)",
        p,
        taskId,
        spec.basisTaskId,
      );
  }
  return files.map((f) => f.id);
}

export function imageDirection(spec: ImageSpec) {
  const direction: Record<ImageSpec["purpose"], string> = {
    单图: "只生成一个明确主体或单个场景的一张画面。",
    角色正面图:
      "生成一张人物正面全身定稿图，完整头顶到脚底，正对镜头，头部清晰可辨；重点展示年龄感、脸型五官、发型、肩宽、腰胯、四肢和身材比例。默认穿不透明、贴合但不勒紧的纯白基础打底服：简洁圆领长袖上衣与长裤，或同等覆盖连体基础服，简洁平底鞋。中性A-pose，身体直立，双臂向两侧斜下外展约30–45度，双手与躯干分离，双脚自然分开。纯净中性背景、均匀柔光、中性透视。不穿剧情服装、裙子、宽袍、盔甲，不带首饰、武器、道具；不以衣物遮挡身形，不裸体、不用内衣代替打底服。只画一个正面人物，不做三视图、面部小窗或拼板。此图只用于人物身份和体型确认；确定后再出三视图、找服装、做穿衣组合。",
    穿衣首样:
      "只生成同一角色穿好指定服装的一张完整造型图，清楚展示脸部、服装和气质，用于首样验收。不要三视图或附加特写。",
    穿衣组合:
      "引用已验收的白色素衣角色基础图或三视图锁定人物身份与体型，引用独立服装图锁定本次衣服款式、颜色与材质，组合生成一张完整穿衣造型。白色素衣被目标服装替换，不把两张参考图拼贴在一起。首样只用于身份与风格参考，不覆盖本次服装图。",
    角色基础图:
      "保持首样人物身份、脸部、发型和身体比例，统一穿白色素衣：不透明、贴合身形但不勒紧的白色基础打底服（简洁圆领长袖上衣与长裤，或同等覆盖的连体基础服），无纹样、装饰和专属配饰；默认中性 A-pose：身体直立、双臂从躯干向两侧斜下张开约 30–45 度、双脚自然分开、双手与躯干分离。不要宽袍、裙子、飘带、厚重衣物或夸张时装姿势，不遮挡四肢轮廓，清楚展示身形。只画一个视角。不要沿用首样剧情服装，不携带武器、枷锁或其他剧情道具。",
    角色三视图:
      "只展示同一角色正面、侧面、背面全身三视图，统一穿白色素衣：不透明、贴合身形但不勒紧的白色基础打底服（简洁圆领长袖上衣与长裤，或同等覆盖的连体基础服），无纹样、装饰和专属配饰；默认中性 A-pose：身体直立、双臂从躯干向两侧斜下张开约 30–45 度、双脚自然分开、双手与躯干分离。不要宽袍、裙子、飘带、厚重衣物或夸张时装姿势，不遮挡四肢轮廓。保持首样人物身份、脸型、发型和身体比例，但不要沿用首样剧情服装，不携带武器、枷锁或其他剧情道具；三个视图采用同一 A-pose、相同比例和白色基础打底服，头顶与脚底对齐，镜头中性不夸张透视。",
    面部特写: "只画已验收首样角色的一张面部特写，保持五官、发型与辨识特征。",
    局部特写:
      "只画本次指定部位的一个局部特写；有已验收参考时保持其细节，不附整体图或其他部位合集。",
    服装图:
      "独立展示本次指定的一套服装（可为首样服装或新服装），明确款式、材质、颜色和纹样，使用无人物的服装展示；不拼入人物肖像、角色身体、场景或其他服装。",
    动作参考: "只画已验收首样角色的一种指定动作姿态，不生成动作合集。",
  };
  return `本次用途：${spec.purpose}。${direction[spec.purpose]} 禁止混合角色、服装、武器、场景、动作合集、特效设定的大拼板，禁止多个不同场景组合，禁止附加说明文字。${spec.purpose === "角色三视图" ? "仅允许上述同角色三视图并列，不附加其他图种。" : "单一画面，不分栏、不分格、不拼贴。"}`;
}
