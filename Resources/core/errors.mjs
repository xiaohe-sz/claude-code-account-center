// Public errors contain fixed messages only. Never forward subprocess output,
// environment values, filesystem exception text, or JSON parse exceptions.
export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new AppError(code, message);
}

export function publicError(error) {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'The operation could not be completed.' };
}
