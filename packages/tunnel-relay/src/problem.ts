/**
 * @fileoverview The relay's answers: a status, headers and an optional JSON body. Every answer other than 2xx carries
 * an RFC 7807 body `{title, detail}` (`[dev-tunnels] rs/src/contracts/problem_details.rs:16-28`); the server adds the
 * `VsSaaS-Request-Id` header the clients record (`management/http_client.rs:345-362`).
 */

/** An answer the server writes. */
export interface Answer {
  status: number;
  body?: unknown;
}

/** A problem answer: its status and its detail, with the title of its status. */
export function problem(status: number, detail: string): Answer {
  return {status, body: {title: titleOf(status), detail}};
}

/** A successful answer with `body` as JSON, or with none. */
export function success(body?: unknown): Answer {
  return body === undefined ? {status: 200} : {status: 200, body};
}

/** The title of a problem's status. */
function titleOf(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 413:
      return 'Payload Too Large';
    default:
      return 'Error';
  }
}

/** A request the relay answers with `answer` before routing it, such as a body it won't read. */
export class Refused extends Error {
  readonly answer: Answer;

  /** A refusal answered with `answer`. */
  constructor(answer: Answer) {
    super(JSON.stringify(answer.body));
    this.answer = answer;
  }
}
