/** Old dressed samples remain valid references; new characters start with a front view. */
export function isCharacterBasis(purpose?: string) {
  return purpose === "角色正面图" || purpose === "穿衣首样";
}
