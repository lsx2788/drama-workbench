import test from "node:test";
import assert from "node:assert/strict";
import { videoPrompt } from "../src/domain/video-prompt";

test("video input copies the single declared section verbatim, without static prompt or management notes", () => {
  const prompt =
    "相机等速后退，人物注视右前方。\n\n黑发向左后方扬起，维持身份。";
  assert.equal(
    videoPrompt(
      `## 文件清单\n图片A，1秒成片。\n## 干净图生视频运动稿（独立模型输入）\n${prompt}\n## 静态提示与参考档案\n人物穿蓝衣。`,
    ),
    prompt,
  );
  assert.equal(
    videoPrompt(`## 干净图生视频提示词（独立通用模型输入）\r\n\r\n${prompt}`),
    prompt,
  );
  assert.equal(
    videoPrompt(`## 可直接复制的视频提示词\n\`\`\`text\n${prompt}\n\`\`\``),
    prompt,
  );
  assert.equal(
    videoPrompt(
      `## 独立干净视频提示词\n沿用已验收分镜，仅复制下列正文：\n\n\`\`\`text\n${prompt}\n\`\`\`\n\n首尾帧分别上传，管理说明不进入模型。`,
    ),
    prompt,
  );
});

test("unlabelled, ambiguous, malformed and management content is not guessed as a video prompt", () => {
  for (const text of [
    "## 静态图提示词\n电影人物，白背景。",
    "## 图片\n```text\n## 视频提示词\n不是视频输入\n```",
    "## 视频提示词\n第一版\n## 图生视频提示词\n第二版",
    "## 视频提示词\n```text\n未关闭",
    "## 视频提示词\n```text\n版本一\n```\n```text\n版本二\n```",
    "## 视频提示词\n说明\n```text\n版本一\n```\n~~~text\n未关闭",
    "## 视频提示词\n```json\n{\"说明\":\"不是干净运动稿\"}\n```",
    "## 视频提示词\n说明\n### 第一段\n不应丢掉的正文",
    "## 视频提示词\n- 文件1作为首帧\n- 时长3秒",
    "## 视频提示词\n",
  ])
    assert.equal(videoPrompt(text), undefined);
});
