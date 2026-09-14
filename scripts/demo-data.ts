export const demoName = "示例 · 青禾剑录";
export const outline = `【演示故事】古装悬疑漫剧，3 集，每集约 90 秒。
一句话：被诬陷偷走赈灾粮的少年沈砚，与掌管账册的江绾循着父亲留下的青禾剑，揭开粮仓监守自盗的真相。
人物：20 岁沈砚冲动但重承诺；19 岁江绾善于查证、不会武功；40 岁沈砚是二十年后的叙述者。青年与中年为同一人物的独立形态。
世界：架空青河县，雨季灾后。冷灰县衙、青黑古渡与金色谷仓构成三组空间；不使用现代器物。
第 1 集《渡口藏账》：中年沈砚在旧渡口提起那把剑；回到二十年前，少年取回父亲遗物，被衙役追赶。江绾用账册残页换取同行。结尾发现粮船去向不是灾区。
第 2 集《两本账》：两人在县衙档案室对照官账与渡口运单，发现同一印记。江绾的上司焚毁官账，但她已记下谷仓位置。结尾沈砚发现父亲也曾在账册上签字。
第 3 集《开仓》：谷仓对峙，剑鞘内的收据证明父亲是查案者。两人当众公布运粮证据，开仓救济。中年沈砚收剑，说明勇气也包括相信别人。
核心约束：青禾剑是证物与人物纽带，不带法术；男主靠协作查证解决冲突；青年和中年不能共用同一张形象图。
样例用途：展示完整流程和资料组织。所有制作节点保持待开始，示例文字资料可读，实际图像、配音、视频尚未制作。`;
export const script = `第 1 集《渡口藏账》· 演示剧本 · 约 90 秒
S01 古渡·黄昏·二十年后（0—12 秒）
40 岁沈砚抚过剑鞘上的缺口。旁白：我二十岁那年，以为一把剑就能讨回公道。
S02 古渡·雨夜·二十年前（12—38 秒）
20 岁沈砚从桥洞取出油布包，露出青禾剑。衙役的灯笼照来。衙役：偷粮的在这里！
沈砚攥紧剑，脚下湿木板发响。桥另一端江绾伸手拦住他：拔剑救不了你。看看这个。
S03 古渡·棚下（38—70 秒）
江绾展开半张运单。特写：青河县官印，交割处却写着北山私仓。
沈砚：父亲说，这船是去灾区的。江绾：所以有人不想让这张纸留下。
身后灯光逼近。沈砚将剑连鞘系回腰间，接过运单。
S04 古渡·船边（70—90 秒）
两人藏入空船。江绾：明早，县衙还有另一本账。
灯笼扫过水面，远处粮船驶向北山。沈砚旁白：那一晚，我第一次收起了剑。
悬念字幕：谁改了运粮的方向？
声音：雨声贯穿青年时段；运单出现时压低环境声；结尾只留橹声与低弦。
资产约束：S01 用 40 岁沈砚；S02—04 用 20 岁沈砚。青禾剑各时代可磨损不同，但鞘口缺痕保留。`;
// Dependencies express this story's proposed process, not a hard-coded application pipeline.
export const stages = [
  {
    key: "control",
    name: "总控协调",
    parents: [],
    input: "用户目标、各节点问题和候选成果",
    output: "已确认重点、协调事项、审核意见",
    review:
      "关键创作选择请用户参与；跨阶段持续协调，不作为所有工作的完成前提。",
  },
  {
    key: "story",
    name: "故事与定位",
    parents: [],
    input: "创作意图、目标观众与篇幅",
    output: "故事大纲、人物关系、风格与边界",
    review: "确认主题、结局、三集结构及青年/中年叙事框架。",
  },
  {
    key: "script",
    name: "分集剧本",
    parents: ["story"],
    input: "已确认故事大纲",
    output: "分集节奏、逐场剧本、对白和旁白",
    review: "检查动机、时间线与每集悬念。",
  },
  {
    key: "breakdown",
    name: "场景拆解",
    parents: ["script"],
    input: "已确认分集剧本",
    output: "场景清单、时段、出场人物、道具与连续性约束",
    review: "逐场列清需求，避免青年与中年形象混用。",
  },
  {
    key: "characters",
    name: "人物与服装设定",
    parents: ["breakdown"],
    input: "人物关系和各场景出场清单",
    output: "人物形态、年龄、服装和外貌规范",
    review: "20 岁与 40 岁沈砚分别登记，同一对象标识关联；主角形象请用户确认。",
  },
  {
    key: "world",
    name: "场景与道具设定",
    parents: ["breakdown"],
    input: "场景拆解与世界观",
    output: "古渡、档案室、谷仓和青禾剑等基础设定",
    review: "明确空间朝向、时间光线及可复用道具特征。",
  },
  {
    key: "base",
    name: "基础图像定稿",
    parents: ["characters", "world"],
    input: "审核过的人物、服装、场景、道具设定",
    output: "单体角色参考图、场景参考图、道具参考图及定稿文件",
    review: "实图入库后审核；文字设定不等于图片定稿。",
  },
  {
    key: "needs",
    name: "场景资产需求分析",
    parents: ["base"],
    input: "剧本场景和已定稿基础图像",
    output: "逐场资产引用、可复用组合、缺项与补制申请",
    review: "先按编号及属性查询；缺少青年持剑图时向总控反馈。",
  },
  {
    key: "composite",
    name: "组合资产制作",
    parents: ["needs"],
    input: "总控确认的组合需求、指定人物和道具定稿版本",
    output: "青年持剑、中年持剑等可复用组合及来源关系",
    review: "核对人物年龄、手部、剑形和持握；图像定稿后再供分镜引用。",
  },
  {
    key: "storyboard",
    name: "分镜与提示词",
    parents: ["composite", "breakdown"],
    input: "逐场剧本、可用资产及组合定稿",
    output: "镜号、时长、景别、动作、运镜、声音和输入版本表",
    review: "每镜引用准确形态，检查画面可执行性与叙事节奏。",
  },
  {
    key: "stills",
    name: "分镜静帧",
    parents: ["storyboard"],
    input: "分镜表与已定稿参考资产",
    output: "镜头首尾帧和画面连续性记录",
    review: "先确认构图、身份和场景连续性，再提交视频生成。",
  },
  {
    key: "audio",
    name: "配音与声音",
    parents: ["storyboard"],
    input: "对白、旁白、分镜时长和声音设计",
    output: "对白轨、旁白轨、环境声、音效和音乐文件",
    review: "核对字音、情绪、时长及素材使用范围。",
  },
  {
    key: "video",
    name: "视频镜头生成",
    parents: ["stills", "audio"],
    input: "审核后的静帧、动作运镜与声音时长",
    output: "逐镜视频文件、生成参数与选片记录",
    review: "检查身份漂移、动作、时长与镜头衔接；失败镜头退回补制。",
  },
  {
    key: "edit",
    name: "剪辑字幕与混音",
    parents: ["video", "audio"],
    input: "已选视频镜头、声音轨和台词",
    output: "剪辑工程、字幕文件、混音与成片候选",
    review: "核对节奏、字幕、声画同步和竖屏安全区。",
  },
  {
    key: "review",
    name: "成片审核",
    parents: ["edit"],
    input: "成片候选、剧本与审核标准",
    output: "审核问题清单、修改决定和通过的成片",
    review: "用户参与最终审核，未通过时反馈到对应节点，不直接归档。",
  },
  {
    key: "archive",
    name: "归档与复用",
    parents: ["review"],
    input: "通过审核的成片、工程和资产引用",
    output: "发布母版、项目归档清单、可复用资产索引",
    review: "核对实际文件可读、批准范围和来源版本；组合资产保留供后续复用。",
  },
] as const;

export interface DemoAsset {
  code: string;
  name: string;
  kind:
    | "character"
    | "prop"
    | "scene"
    | "composite"
    | "document"
    | "image"
    | "audio"
    | "video";
  stage: string;
  description: string;
  entityKey?: string;
  attributes?: Record<string, string | number | boolean>;
  sources?: string[];
  content?: unknown;
}
export const demoAssets: DemoAsset[] = [
  {
    code: "CHR-SY-20",
    name: "沈砚 · 20 岁形象设定",
    kind: "character",
    stage: "characters",
    entityKey: "shen-yan",
    description: "青年男主；设定文档已保存，参考图片待制作。",
    attributes: {
      age: 20,
      costume: "青灰短袍、旧布腰带",
      appearance: "黑发束起、清瘦、左眉浅疤",
      personality: "冲动、重承诺",
    },
    content: {
      identity: "沈砚青年",
      visualRules: ["不能出现中年胡茬", "左眉浅疤固定", "服装不使用现代拉链"],
    },
  },
  {
    code: "CHR-SY-40",
    name: "沈砚 · 40 岁形象设定",
    kind: "character",
    stage: "characters",
    entityKey: "shen-yan",
    description: "中年叙述者，与青年为同一人不同形态；参考图片待制作。",
    attributes: {
      age: 40,
      costume: "墨绿长袍",
      appearance: "鬓角微白、短须、左眉浅疤",
      personality: "沉静、克制",
    },
    content: {
      identity: "沈砚中年",
      visualRules: [
        "保留左眉浅疤",
        "与青年脸型骨架相承",
        "不得直接复用青年持剑图",
      ],
    },
  },
  {
    code: "CHR-JW-19",
    name: "江绾 · 19 岁形象设定",
    kind: "character",
    stage: "characters",
    entityKey: "jiang-wan",
    description: "县衙抄录员，女主；以查证和记忆推动剧情。",
    attributes: {
      age: 19,
      costume: "米白内衫、靛蓝外衣",
      appearance: "低发髻、袖口墨渍",
      personality: "冷静、观察敏锐",
    },
    content: {
      visualRules: ["腰间携小笔袋", "不会武功", "情绪主要以眼神与语速体现"],
    },
  },
  {
    code: "PRP-SWORD",
    name: "青禾剑 · 道具设定",
    kind: "prop",
    stage: "world",
    entityKey: "qinghe-sword",
    description: "普通铁剑，鞘口缺痕是跨时代识别点；不发光、无法术。",
    attributes: {
      appearance: "暗青木鞘、铜护手、鞘口三角缺痕",
      purpose: "父亲遗物与收据藏处",
    },
    content: {
      material: "铁刃、木鞘、铜护手",
      continuity: "二十年后铜色变暗，缺痕位置不变",
    },
  },
  {
    code: "PRP-LEDGER",
    name: "运单残页 · 道具设定",
    kind: "prop",
    stage: "world",
    description: "第 1 集关键线索；官印与北山私仓字样需要特写可读。",
    content: {
      text: "青河县赈粮，交割：北山私仓",
      appearance: "泛黄纸、右下撕裂、红色官印",
    },
  },
  ...[
    {
      code: "SCN-DOCK",
      name: "古渡",
      light: "青年雨夜冷光；中年黄昏暖光",
      layout: "桥洞在南、棚下在东、空船在西",
    },
    {
      code: "SCN-ARCHIVE",
      name: "县衙档案室",
      light: "白日窄窗冷光",
      layout: "账架靠北、长桌居中、出入口在南",
    },
    {
      code: "SCN-GRANARY",
      name: "北山谷仓",
      light: "清晨金色斜光",
      layout: "双扇木门朝东，粮袋在两侧留出中央通道",
    },
  ].map((scene): DemoAsset => ({
    code: scene.code,
    name: `${scene.name} · 场景设定`,
    kind: "scene",
    stage: "world",
    description: `${scene.light}。${scene.layout}。`,
    attributes: { scene: scene.name, appearance: scene.layout },
    content: scene,
  })),
  {
    code: "DOC-BREAKDOWN",
    name: "第 1 集 · 场景拆解表",
    kind: "document",
    stage: "breakdown",
    description: "按时段和年龄形态列出 S01—S04 的需求。",
    content: [
      {
        scene: "S01",
        period: "二十年后黄昏",
        assets: ["CHR-SY-40", "PRP-SWORD", "SCN-DOCK"],
      },
      {
        scene: "S02",
        period: "二十年前雨夜",
        assets: ["CHR-SY-20", "PRP-SWORD", "SCN-DOCK"],
      },
      {
        scene: "S03/S04",
        period: "二十年前雨夜",
        assets: ["CHR-SY-20", "CHR-JW-19", "PRP-LEDGER", "SCN-DOCK"],
      },
    ],
  },
  {
    code: "DOC-BASE",
    name: "基础图像 · 制作清单",
    kind: "document",
    stage: "base",
    description: "主角三形态三视图、道具正侧面和三场景参考图；实际图片待生成。",
    content: {
      checklist: [
        "青年沈砚三视图",
        "中年沈砚三视图",
        "江绾三视图",
        "青禾剑正侧面",
        "古渡两时段",
        "档案室",
        "谷仓",
      ],
      approval: "原图归档后逐资产审核；文字定稿不能充当图片输入",
    },
  },
  {
    code: "DOC-NEEDS",
    name: "场景组合需求与复用清单",
    kind: "document",
    stage: "needs",
    description: "先查已有组合，青年持剑与中年持剑分别申请，总控审核后入库。",
    sources: ["CHR-SY-20", "CHR-SY-40", "PRP-SWORD"],
    content: {
      requests: [
        {
          scene: "S01",
          composite: "CMP-SY40-SWORD",
          reason: "中年抚剑，不能使用青年图",
        },
        {
          scene: "S02",
          composite: "CMP-SY20-SWORD",
          reason: "青年连鞘握剑，可复用至第三集",
        },
      ],
      reuse: "同一年龄、衣装、剑版本满足要求时复用；姿势变化需要新组合",
    },
  },
  {
    code: "CMP-SY20-SWORD",
    name: "沈砚 20 岁持剑 · 组合规范",
    kind: "composite",
    stage: "composite",
    entityKey: "shen-yan",
    attributes: { age: 20, purpose: "第 1、3 集复用" },
    description: "青年形态与青禾剑的组合要求，已保存来源版本；组合图待制作。",
    sources: ["CHR-SY-20", "PRP-SWORD"],
    content: {
      pose: "右手握住带鞘青禾剑，左手扶腰带",
      continuity: ["青灰短袍", "左眉浅疤", "剑鞘缺痕可见"],
      reusable: true,
    },
  },
  {
    code: "CMP-SY40-SWORD",
    name: "沈砚 40 岁持剑 · 组合规范",
    kind: "composite",
    stage: "composite",
    entityKey: "shen-yan",
    attributes: { age: 40, purpose: "首尾叙述框架复用" },
    description: "中年形态与青禾剑分别引用；与青年组合并存，组合图待制作。",
    sources: ["CHR-SY-40", "PRP-SWORD"],
    content: {
      pose: "双手横托带鞘青禾剑，拇指抚缺痕",
      continuity: ["墨绿长袍", "鬓角微白", "护手铜色较暗"],
      reusable: true,
    },
  },
  {
    code: "DOC-STORYBOARD",
    name: "第 1 集 · 分镜与提示词草案",
    kind: "document",
    stage: "storyboard",
    description:
      "6 个镜头覆盖 90 秒；当前是文字演示，实际生产需绑定定稿图版本。",
    sources: ["CMP-SY40-SWORD", "CMP-SY20-SWORD", "SCN-DOCK"],
    content: [
      {
        shot: "E01-001",
        seconds: 12,
        frame: "剑鞘特写缓慢拉至中年沈砚",
        refs: ["CMP-SY40-SWORD", "SCN-DOCK"],
        prompt: "黄昏古渡，墨绿长袍中年人横托旧剑，缓慢后拉，克制",
      },
      {
        shot: "E01-002",
        seconds: 13,
        frame: "桥洞中景，青年取剑，灯笼扫入",
        refs: ["CMP-SY20-SWORD", "SCN-DOCK"],
      },
      { shot: "E01-003", seconds: 13, frame: "青年与江绾正反打，江绾示意停下" },
      { shot: "E01-004", seconds: 16, frame: "运单特写，官印与北山私仓字样" },
      { shot: "E01-005", seconds: 16, frame: "双人中景，青年收剑接运单" },
      {
        shot: "E01-006",
        seconds: 20,
        frame: "空船内对话后切远景，粮船驶往北山",
      },
    ],
  },
  {
    code: "DOC-STILLS",
    name: "分镜静帧 · 交付规范",
    kind: "document",
    stage: "stills",
    description: "逐镜首尾帧命名、纵向构图和连续性要求。",
    content: {
      format: "9:16，目标 1080×1920",
      naming: "E01-镜号-start/end-v版本",
      checks: [
        "青年/中年引用正确",
        "视线和剑位置连续",
        "不烘焙对白字幕",
        "定稿文件与候选分开",
      ],
    },
  },
  {
    code: "DOC-AUDIO",
    name: "第 1 集 · 声音脚本",
    kind: "document",
    stage: "audio",
    description: "旁白、角色对白和雨声分轨保存；音频尚未制作。",
    content: {
      narrator: "中年沈砚，低缓、回忆感",
      voices: ["青年沈砚急促但不喊叫", "江绾冷静清楚"],
      tracks: ["旁白", "对白", "雨声", "橹声", "低弦"],
      cue: "运单特写压低雨声，结尾橹声推进悬念",
    },
  },
  {
    code: "DOC-VIDEO",
    name: "视频镜头 · 生成与选片规范",
    kind: "document",
    stage: "video",
    description: "按镜头分段生成、候选选片和定稿登记，避免一次生成整集。",
    content: {
      inputs: ["已批准首尾帧版本", "镜头提示词", "声音时长"],
      rejection: ["人物身份漂移", "多手或穿模", "剑形变化", "空间跳变"],
      retry: "失败原因反馈到总控，重生成不覆盖原候选",
    },
  },
  {
    code: "DOC-EDIT",
    name: "剪辑与字幕 · 工程约定",
    kind: "document",
    stage: "edit",
    description: "6 镜组合约 90 秒，保留工程、字幕和混音分轨。",
    content: {
      timeline: "12+13+13+16+16+20=90 秒",
      subtitle: "逐句校对、最多两行、避开底部操作区",
      outputs: ["可编辑工程", "SRT 字幕", "对白和环境声分轨", "成片候选"],
    },
  },
  {
    code: "DOC-REVIEW",
    name: "成片审核 · 检查清单",
    kind: "document",
    stage: "review",
    description: "故事、人物、声画与字幕逐项验收，问题回到来源节点。",
    content: {
      checks: [
        "首尾年龄正确",
        "证据揭示与剧本一致",
        "人物与剑连续",
        "对白清楚且同步",
        "字幕无错字",
        "文件完整可播放",
      ],
      decision: "待实际成片生成后填写，不预设通过",
    },
  },
  {
    code: "DOC-ARCHIVE",
    name: "项目归档 · 复用规则",
    kind: "document",
    stage: "archive",
    description: "母版、工程、定稿资产和引用清单一并保留；组合资产可跨集复用。",
    content: {
      package: [
        "成片母版",
        "剪辑工程",
        "字幕及声音分轨",
        "批准版本索引",
        "来源与使用关系",
      ],
      reuse: "按实体、年龄、衣装及具体版本检索；新版本不会自动替换既有镜头",
    },
  },
  {
    code: "IMG-SY20",
    name: "沈砚 20 岁 · 参考图需求",
    kind: "image",
    stage: "base",
    description: "待生成的真实图片；目前只有需求，不能作为定稿输入。",
    attributes: { age: 20, format: "PNG" },
    sources: ["CHR-SY-20"],
  },
  {
    code: "AUD-E01",
    name: "第 1 集 · 声音文件需求",
    kind: "audio",
    stage: "audio",
    description: "旁白、对白、环境声分轨，待生成并审核实际音频。",
    attributes: { episode: 1, format: "WAV" },
    sources: ["DOC-AUDIO"],
  },
  {
    code: "VID-E01",
    name: "第 1 集 · 成片文件需求",
    kind: "video",
    stage: "edit",
    description: "目标 90 秒竖屏成片，待镜头和音轨完成后剪辑；暂无视频文件。",
    attributes: { episode: 1, format: "MP4 1080×1920" },
    sources: ["DOC-EDIT"],
  },
];
