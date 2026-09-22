export type BoardSections = { main: string; sound: string; reference: string };

/** Group labelled bullet blocks for reading only; leave unfamiliar formats intact. */
export function boardSections(text: string): BoardSections | null {
  if (/```|~~~/.test(text)) return null;
  const blocks = text.split(/(?=^[-*+]\s+)/m);
  const groups: Record<keyof BoardSections, string[]> = {
    main: [],
    sound: [],
    reference: [],
  };
  let labelled = 0;
  for (const block of blocks) {
    const label = block
      .split("\n", 1)[0]
      .replace(/\*\*/g, "")
      .match(/^[-*+]\s+([^：:]{1,35})[：:]/)?.[1];
    if (label) labelled++;
    const group =
      label && /^(对白|旁白|音效|音乐|后期字幕)/.test(label)
        ? "sound"
        : label &&
            /^(引用图片|通用视频生成提示词|视频生成提示词|风险与执行|资产需求)/.test(
              label,
            )
          ? "reference"
          : "main";
    groups[group].push(block);
  }
  if (labelled < 3 || !groups.main.join("").trim()) return null;
  return {
    main: groups.main.join(""),
    sound: groups.sound.join(""),
    reference: groups.reference.join(""),
  };
}
