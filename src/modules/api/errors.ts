export type ApiFieldError = { path: string; message: string };

/** An error with the HTTP status it should be answered with (as problem+json). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: ApiFieldError[],
  ) {
    super(detail ? `${title}: ${detail}` : title);
    this.name = "ApiError";
  }
}

export const badRequest = (detail: string, errors?: ApiFieldError[]) =>
  new ApiError(400, "Bad Request", detail, errors);

export const notFound = (what: string) =>
  new ApiError(404, "Not Found", `${what} not found`);
