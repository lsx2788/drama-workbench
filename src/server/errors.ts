export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  message: string,
  code = "INVALID",
  status = 400,
): asserts value {
  if (!value) throw new DomainError(code, message, status);
}
