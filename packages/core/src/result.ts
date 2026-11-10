// Errors as values. Nothing in core throws. A function that can fail
// returns a Result, and the caller has to look at `ok` before using it.

export type Success<T> = { ok: true; value: T };
export type Failure = { ok: false; errors: string[] };
export type Result<T> = Success<T> | Failure;

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(message: string): Failure {
  return { ok: false, errors: [message] };
}

export function failAll(errors: string[]): Failure {
  return { ok: false, errors };
}

// The errors of a result, or an empty list. Used to collect the errors of
// several results before deciding whether to go on.
export function errorsOf(result: Result<unknown>): string[] {
  return result.ok ? [] : result.errors;
}

export function mapResult<A, B>(result: Result<A>, change: (value: A) => B): Result<B> {
  return result.ok ? ok(change(result.value)) : result;
}

export function andThen<A, B>(result: Result<A>, next: (value: A) => Result<B>): Result<B> {
  return result.ok ? next(result.value) : result;
}

// Turns a list of results into one result holding a list. If any failed,
// the errors of all of them are kept, not only the first.
export function allOk<T>(results: Result<T>[]): Result<T[]> {
  const errors = results.flatMap(errorsOf);
  if (errors.length > 0) return failAll(errors);
  return ok(results.flatMap((result) => (result.ok ? [result.value] : [])));
}

// Adds where the error happened, for example "tracks[2].timing: ...".
export function at<T>(path: string, result: Result<T>): Result<T> {
  if (result.ok) return result;
  return failAll(result.errors.map((message) => `${path}: ${message}`));
}
