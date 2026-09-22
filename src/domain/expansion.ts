/** Structured, version-bound slices of a reviewed screenplay or storyboard. */
export type OutputStructure = {
  kind: "episodes" | "shots";
  representative: number;
  reason: string;
  complete?: boolean;
  items: { number: number; title: string; text: string; synopsis: string }[];
};
