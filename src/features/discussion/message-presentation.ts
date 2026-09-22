import type { Message } from "../../domain/types";

/** One visible task card; raw messages and historical image revisions remain stored. */
export function discussionMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  const anchors = new Map<string, number>();
  for (const message of messages) {
    if (message.taskId && message.execution)
      anchors.set(message.taskId, result.length);
    const anchor = message.taskId ? anchors.get(message.taskId) : undefined;
    if (
      message.image &&
      anchor !== undefined &&
      anchor < result.length &&
      !message.confirmation &&
      !message.replyToId
    ) {
      const original = result[anchor];
      result[anchor] = {
        ...original,
        text: `图片：${message.image.name}`,
        image: message.image,
        audience: "human",
      };
    } else result.push(message);
  }
  return result;
}

export function isProcessMessage(message: Message) {
  if (
    message.sender === "你" ||
    message.confirmation ||
    message.image ||
    message.execution ||
    message.feedback ||
    message.attachments?.length
  )
    return false;
  return (
    !!message.questionTransfer ||
    message.audience === "agents" ||
    message.phase === "commentary"
  );
}

export type DiscussionEntry =
  | { kind: "message"; id: string; message: Message }
  | { kind: "activity"; id: string; messages: Message[] };

/** Collapse only adjacent process records; decisions and images keep their place. */
export function discussionTimeline(messages: Message[]): DiscussionEntry[] {
  const entries: DiscussionEntry[] = [];
  for (const message of discussionMessages(messages)) {
    if (!isProcessMessage(message)) {
      entries.push({ kind: "message", id: message.id, message });
      continue;
    }
    const last = entries.at(-1);
    if (last?.kind === "activity") last.messages.push(message);
    else
      entries.push({ kind: "activity", id: message.id, messages: [message] });
  }
  return entries;
}

/** Only remove the exact quote the composer inserted, never arbitrary user text. */
export function messageReplyBody(message: Message, messages: Message[]) {
  const original = messages.find((item) => item.id === message.replyToId);
  if (!original) return { text: message.text };
  const prefix = `> ${original.text.replaceAll("\n", "\n> ")}\n\n`;
  if (!message.text.startsWith(prefix)) return { text: message.text };
  return { text: message.text.slice(prefix.length), quote: original };
}
