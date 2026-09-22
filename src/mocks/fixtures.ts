import {
  epId,
  shotId,
  type Task,
  type TaskKind,
  type StudioProject,
  type StudioState,
} from "@/domain";

const episodeStories = [
  [
    "雨夜来信",
    "修伞师沈青禾收到父亲留下的半封信，信中提到已封闭十年的听雨楼。",
  ],
  ["旧桥寻人", "青禾在旧桥找到送信人，却发现有人提前买走了他手中的铜钥匙。"],
  ["灯下辨伪", "账房陆知微识破假钥匙上的新锈，两人沿着铜匠的账册追查。"],
  ["铜匠无声", "失声的铜匠用图案留下线索，指向城南一批被调换的赈灾粮。"],
  ["粮仓暗门", "二人潜入粮仓，发现失踪者名单和听雨楼的修缮记录。"],
  ["故人的账", "知微认出账册中的父亲笔迹，二人第一次对调查方向产生分歧。"],
  ["半封真相", "两封残信拼合，揭开青禾父亲保护证人的往事。"],
  ["风起城南", "青禾救出旧案证人，却失去进入听雨楼的最后一把钥匙。"],
  ["赴约之前", "知微决定公开账册，青禾利用伞骨制作工具，准备在雨夜赴约。"],
  [
    "听雨见光",
    "青禾在听雨楼与守楼人对峙，用旧伞中的印章换得证据；知微在楼下点亮灯火，证人终于走出阴影。",
  ],
];
const shotStories = [
  ["雨巷入楼", "远景，雨水沿瓦檐落下，青禾撑旧伞走向听雨楼。镜头缓慢推进。", 8],
  ["灯影露面", "中景，守楼人从门后走出，灯光照亮他的半边脸。", 7],
  [
    "伞骨藏印",
    "手部特写，青禾旋开伞柄，取出父亲留下的铜印。动作清楚，镜头固定。",
    6,
  ],
  ["隔桌试探", "双人中景，青禾将铜印放在桌沿，守楼人没有伸手。", 9],
  ["窗外信号", "近景，知微在楼下举起灯笼，火光透过窗纸映入屋内。", 7],
  ["旧案重提", "青禾近景：‘这枚印，不是拿来换钱的。’停顿后抬眼。", 10],
  [
    "证据易手",
    "侧面中景，守楼人递出账册，青禾接过；手的运动与道具位置连贯。",
    8,
  ],
  ["灯火成列", "窗外远景，数盏灯笼依次点亮，巷中等待的人渐渐显现。", 8],
  ["证人出门", "中景，老人跨过门槛，知微迎上前扶住他。", 9],
  ["雨停天明", "楼外全景，青禾收伞，与知微并肩走下台阶，晨光照亮匾额。", 8],
] as const;

export function buildProject(
  id = "qinghe",
  name = "青禾 · 听雨录",
  episodeCount = 10,
  shotsPerEpisode = 10,
  ready = true,
): StudioProject {
  const tasks: Record<string, Task> = {};
  const add = (
    id: string,
    kind: TaskKind,
    title: string,
    dependencies: string[],
    text = "",
    approved = false,
    episode?: number,
    shot?: number,
  ) => {
    tasks[id] = {
      id,
      kind,
      title,
      objective: `交付可供后续使用的${title}，遵守当前制作需求与已确认基准。`,
      dependencies,
      enabled: true,
      reviewEnabled: true,
      delivery: approved ? "approved" : "empty",
      text,
      revision: text ? 1 : 0,
      history: [],
      assetIds: [],
      reuseReason: "",
      episode,
      shot,
    };
  };
  add(
    "source",
    "source",
    "原作理解",
    [],
    "材料类型：古装悬疑短篇小说。\n内容概况：修伞师沈青禾和账房陆知微追查一桩旧案。\n核心人物：沈青禾，24 岁，克制、细致；陆知微，25 岁，果断、擅长辨账。\n已读范围：本预览中的故事梗概及十集梗概。未读取外部小说。\n推测与未知：对白和细节尚需编剧展开。",
    ready,
  );
  add(
    "brief",
    "brief",
    "制作需求",
    ["source"],
    "制作目标：十集短剧。\n制作范围：从雨夜收到来信，到听雨楼旧案揭晓。\n风格：古装悬疑，克制的真人影视感。\n集数与时长：10 集，每集约 90 秒。\n画幅：竖屏 9:16。\n改编要求：保留调查主线与人物关系，允许压缩支线。\n补充要求：动作清晰，不用旁白替代关键情节。\n待明确：具体声音与剪辑由人工处理。",
    ready,
  );
  add(
    "script",
    "script",
    "整体剧本",
    ["brief"],
    "青禾沿父亲留下的线索进入旧案，知微从怀疑到合作。前四集建立线索，中四集揭示代价，末两集完成选择。\n\n推荐代表性剧集：第 10 集《听雨见光》。\n推荐原因：同时包含人物对白、动作、道具交接与雨夜场景，适合验证画面连续性。\n推荐分镜候选：伞骨藏印，动作边界清晰，包含人物与道具组合。",
    ready,
  );
  const episodes = Array.from({ length: episodeCount }, (_, i) => {
    const n = i + 1,
      story = episodeStories[i % episodeStories.length];
    add(
      epId(n),
      "episode",
      `第 ${String(n).padStart(2, "0")} 集 · ${story[0]}`,
      ["script"],
      ready
        ? `${story[1]}\n\n场景一：线索出现。以人物动作建立当前处境。\n场景二：围绕本集线索展开冲突与选择。\n场景三：人物获得新信息，留下与后续情节衔接的结果。\n\n这是交互预览中的编剧稿，用于查看流程与审核关系。`
        : "",
      ready,
      n,
    );
    for (let s = 1; s <= shotsPerEpisode; s++) {
      const base = shotStories[(s - 1) % shotStories.length];
      const representative =
        n === Math.min(10, episodeCount) && s === 3 && ready;
      add(
        shotId(n, s),
        "board",
        `镜头 ${String(s).padStart(2, "0")} · ${n === 10 ? base[0] : ["环境建立", "人物出现", "线索特写", "对白交锋", "动作反应", "冲突推进", "人物选择", "结果呈现", "线索交接", "结尾悬念"][(s - 1) % 10]}`,
        [epId(n)],
        representative
          ? `${base[1]}\n\n时长：${base[2]} 秒。\n场景：听雨楼内，雨夜暖灯。\n人物：沈青禾，24 岁，青灰外衣。\n道具：旧油纸伞、铜印。\n首帧：双手握伞柄，铜印尚未露出。\n关键动作图：旋开伞柄，右手取出铜印，左手保持握伞。\n尾帧：铜印置于掌心，为下一镜交接留出空间。`
          : "",
        representative,
        n,
        s,
      );
      add(
        shotId(n, s, "assets"),
        "assets",
        "基础资产准备",
        [shotId(n, s)],
        "",
        false,
        n,
        s,
      );
      add(
        shotId(n, s, "frames"),
        "frames",
        "镜头画面制作",
        [shotId(n, s, "assets")],
        "",
        false,
        n,
        s,
      );
      add(
        shotId(n, s, "video"),
        "video",
        "镜头视频 · 人工处理",
        [shotId(n, s, "frames")],
        "",
        false,
        n,
        s,
      );
    }
    add(
      `episode-${n}-assembly`,
      "assembly",
      `第 ${String(n).padStart(2, "0")} 集视频`,
      Array.from({ length: shotsPerEpisode }, (_, j) =>
        shotId(n, j + 1, "video"),
      ),
      "",
      false,
      n,
    );
    return {
      number: n,
      title: story[0],
      synopsis: story[1],
      shots: shotsPerEpisode,
    };
  });
  return {
    id,
    name,
    confirmed: ready,
    representativeEpisode: Math.min(10, episodeCount),
    representativeShot: Math.min(3, shotsPerEpisode),
    episodes,
    tasks,
    assets: ready
      ? [
          {
            id: "CHAR-001",
            name: "沈青禾 · 24 岁",
            category: "人物",
            status: "approved",
            description:
              "青灰外衣，束发，克制沉静。适用于当前十集；人物设定文本已确认，图像待人工补充。",
            version: 1,
            sourceIds: [],
          },
          {
            id: "CHAR-002",
            name: "陆知微 · 25 岁",
            category: "人物",
            status: "approved",
            description: "靛蓝长衫，利落发髻，随身携带账册。人物设定文本。",
            version: 1,
            sourceIds: [],
          },
          {
            id: "SCENE-001",
            name: "听雨楼 · 雨夜",
            category: "场景",
            status: "approved",
            description: "木窗、长桌、暖色油灯，窗外冷雨。场景设定文本。",
            version: 1,
            sourceIds: [],
          },
          {
            id: "PROP-001",
            name: "藏印油纸伞",
            category: "道具",
            status: "approved",
            description: "旧竹骨伞，伞柄内有可旋开的铜印暗格。道具设定文本。",
            version: 1,
            sourceIds: [],
          },
          {
            id: "CHAR-003",
            name: "沈青禾 · 中年候选",
            category: "人物",
            status: "draft",
            description: "40 岁形态候选，不参与已通过资产的复用查询。",
            version: 1,
            sourceIds: ["CHAR-001"],
          },
        ]
      : [],
    sources: [],
    events: [],
    messages: ready
      ? [
          {
            id: "msg1",
            sender: "你",
            text: "先做十集，保持古装悬疑的质感。选有代表性的片段，先把整个制作链路走通。",
            time: "2026-09-17T01:00:00Z",
          },
          {
            id: "msg2",
            sender: "编剧 AI",
            text: "推荐第 **10 集《听雨见光》**。这一集包含对白、道具交接和雨夜环境，可验证人物与画面的连续性。",
            time: "2026-09-17T01:01:00Z",
            taskId: "script",
          },
          {
            id: "msg3",
            sender: "总控 AI",
            text: "制作需求与剧本已记录。先推进第 10 集的 **03 号镜头「伞骨藏印」**，完成镜头视频后再扩展。\n\n这是推荐顺序；你也可以先开展其他已具备输入的分镜任务。",
            time: "2026-09-17T01:02:00Z",
            taskId: shotId(10, 3),
          },
        ]
      : [],
  };
}
export const initialState = (): StudioState => ({
  schema: 1,
  projects: [buildProject()],
  activeId: "qinghe",
});

/** Intentionally authored templates, not model output or inferred source content. */
export function mockDraft(project: StudioProject, task: Task): string {
  if (task.text) return task.text;
  const episode = project.episodes.find((e) => e.number === task.episode);
  if (task.kind === "board")
    return `演示分镜草稿｜${episode?.title} · ${task.title}\n\n画面：围绕本集「${episode?.synopsis}」选取一个明确的动作或反应。\n景别：中景；镜头固定。\n动作：人物观察线索，停顿，再做出一个清晰动作。\n预计时长：8 秒，实际时长待制作验证。\n首帧、关键动作图：根据本镜头动作补充。\n\n以上为交互模板，不是 AI 对原作的分析结果。`;
  if (task.kind === "assets")
    return "资产需求：人物、场景、道具。\n请从审核通过的资产中选择适配项；缺少的在查询依据中说明差异。\n已有设定文本不代表人物图已完成。";
  if (task.kind === "frames")
    return "首帧：人物握住道具，明确初始构图。\n关键动作图：动作中间姿态与手部接触关系。\n尾帧：结束状态，为下一镜衔接。\n\n本预览仅保存制作说明，图像文件由人工添加；不会自动生成图片。";
  return "请依据原文与已确认制作需求填写本节点产出。此处为演示编辑位置，不会自动调用 AI 或解析文件。";
}
