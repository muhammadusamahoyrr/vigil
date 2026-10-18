// Errors that carry an HTTP status. Routes map them with route() in src/lib/api.ts.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export const unauthorized = (message = 'Please log in.') => new ApiError(401, message)
export const forbidden = (message = 'You do not have permission to do this.') => new ApiError(403, message)
