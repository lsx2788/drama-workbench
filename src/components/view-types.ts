import type { FormKind } from "./create-form";
export type CreateAction = (
  kind: FormKind,
  defaults?: Record<string, string>,
) => void;
