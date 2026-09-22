export type SkillFields = {
  enabled: boolean;
  instructions: string;
  review: string;
};
export const defaultSkillFields = (): SkillFields => ({
  enabled: true,
  instructions: "",
  review: "",
});
export type SkillEntry = {
  id: string;
  title: string;
  description: string;
  version: string;
  customRevision: number;
  enabled: boolean;
  references: string[];
};
export type SkillDetail = SkillEntry & {
  resources: Record<string, string>;
  fields: SkillFields;
  versions: { revision: number; createdAt: string }[];
};
export type SkillLoad = {
  id: string;
  title: string;
  version: string;
  customRevision: number;
  section: string;
  mode: "production" | "review";
  reason: string;
  body: string;
  loadedAt: string;
};
