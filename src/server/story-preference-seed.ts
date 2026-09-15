import type { PreferenceCategory } from "../shared/story-preferences";
export const STORY_STYLES = [
  { value: "discuss", label: "让 AI 阅读后再一起讨论" },
  { value: "live_action", label: "真人影视感" },
  { value: "anime_2d", label: "2D 动漫" },
  { value: "animation_3d", label: "3D 动画" },
  { value: "ink", label: "国风水墨" },
  { value: "illustration", label: "绘本插画" },
  { value: "other", label: "其他（自定义）", detailLabel: "描述你希望的风格" },
] as const;
const discuss = { value: "discuss", label: "稍后与总控讨论" };
const other = {
  value: "other",
  label: "其他（自定义）",
  detailLabel: "填写你的要求",
};
/** Initial data only. Live options are read from the database. */
export const INITIAL_STORY_PREFERENCES: readonly PreferenceCategory[] = [
  {
    id: "style",
    label: "画面风格",
    description: "希望画面呈现什么感觉",
    options: STORY_STYLES,
  },
  {
    id: "scope",
    label: "制作范围",
    description: "先制作故事的哪一部分",
    options: [
      discuss,
      { value: "whole", label: "整个故事" },
      { value: "first_episode", label: "先做第一集" },
      {
        value: "selected",
        label: "指定章节或片段",
        detailLabel: "填写章节或片段范围",
      },
      other,
    ],
  },
  {
    id: "adaptation",
    label: "改编要求",
    description: "哪些内容可以调整",
    options: [
      discuss,
      { value: "faithful", label: "尽量忠实原文" },
      { value: "condense", label: "保留主线，允许压缩情节" },
      { value: "flexible", label: "可以较大改编，具体调整先讨论" },
      other,
    ],
  },
  {
    id: "duration",
    label: "单集时长",
    description: "每集大致希望多长",
    options: [
      discuss,
      { value: "under_minute", label: "1 分钟以内" },
      { value: "one_to_three", label: "1～3 分钟" },
      { value: "three_to_five", label: "3～5 分钟" },
      other,
    ],
  },
  {
    id: "aspect",
    label: "画幅",
    description: "画面采用什么比例",
    options: [
      discuss,
      { value: "portrait", label: "竖屏 9:16" },
      { value: "landscape", label: "横屏 16:9" },
      { value: "square", label: "方形 1:1" },
      other,
    ],
  },
  {
    id: "platform",
    label: "发布平台",
    description: "计划在哪里发布或观看",
    options: [
      discuss,
      { value: "douyin", label: "抖音" },
      { value: "kuaishou", label: "快手" },
      { value: "bilibili", label: "哔哩哔哩" },
      { value: "xiaohongshu", label: "小红书" },
      {
        value: "multiple",
        label: "多个平台",
        detailLabel: "填写计划发布的平台",
      },
      other,
    ],
  },
];
