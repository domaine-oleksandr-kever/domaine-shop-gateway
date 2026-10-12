/** A refusal the admin API reports to the browser as `{ error: message }` with this status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
