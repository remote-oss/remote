/**
 * @fileoverview The protocol connection of the harness's page reads (card #2858): one `Runtime.evaluate` over a socket
 * of the editor's debugging port, bounded, so that a renderer that does not answer, or a socket that closes first, ends
 * the read with a message that names the page and the read, in place of a row that waits for mocha's timeout.
 */

/** The answer of the protocol's `Runtime.evaluate`. */
interface EvaluateAnswer {
  id: number;
  result?: {
    result?: {value?: unknown};
    exceptionDetails?: {
      text: string;
      exception?: {description?: string};
    };
  };
  error?: {message: string};
}

/**
 * How long a read may wait for its answer, in milliseconds. Measured, not guessed: in a run of the readers that wait or
 * read the most (the terminal, Open Recent and host-pick rows of ssh-core, the view rows of the explorer and the Ports
 * view; 57 rows) the page answered 99.9 % of its reads in 210 ms or less and none took 2 s, so 30 s is over a hundred
 * times the slowest read seen and still ends a hung read well before a row's own wait of a minute. The reads that wait
 * inside the page to walk a list take longer and pass their own bound ({@link LONG_READ_MILLISECONDS}).
 */
const EVALUATE_MILLISECONDS = 30_000;

/**
 * How long the reads that wait inside the page to walk a whole list may take: the longest legitimate ones. Every read
 * whose in-page code loops with `while` and awaits (`viewRows`, `portsRows`, `allQuickPickRows`) passes it; a row in
 * `tools/page-protocol.test.ts` fails when a function of the renderer's helpers has such a loop and does not.
 */
export const LONG_READ_MILLISECONDS = 300_000;

/**
 * How long the follow-up read of the diagnostics may take, once the read's own bound already fired: a page whose
 * timers are throttled still answers an evaluate, so a short bound is ample, and a page that is stuck costs this
 * much on top of the bound that already ended the read.
 */
const DIAGNOSTICS_MILLISECONDS = 5_000;

/** The read's own failure for a page that gave no answer in time: a read that a row may want to take as "unavailable". */
export class NoAnswerError extends Error {}

/** The first characters of `expression` on one line, which names the read in a failure. */
export function excerptOf(expression: string): string {
  return JSON.stringify(expression.replace(/\s+/gu, ' ').trim().slice(0, 120));
}

/**
 * Evaluates `expression` in the page at protocol address `address` and returns its value; `owner` names the page in a
 * failure. A page that does not answer within `milliseconds` fails the read with a {@link NoAnswerError} that names
 * the page and the first characters of the expression, and so does a socket that closes before the answer. When the
 * bound fired and a `diagnosticsExpression` was given, the page is asked once more, briefly, for that expression,
 * and an answer joins the failure: a page whose timers are throttled still answers an evaluate, so the trace it
 * left on itself survives the bound.
 */
export async function evaluateAt<Value>(
  address: string,
  owner: string,
  expression: string,
  milliseconds: number = EVALUATE_MILLISECONDS,
  diagnosticsExpression?: string,
): Promise<Value> {
  const seconds = String(Math.round(milliseconds / 100) / 10);
  const socket = new WebSocket(address);
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`no protocol connection to ${owner}`));
      });
    });
    let answer: EvaluateAnswer;
    try {
      answer = await new Promise<EvaluateAnswer>((resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new NoAnswerError(
              `${owner}: no answer within ${seconds} s to ${excerptOf(expression)}`,
            ),
          );
        }, milliseconds);
        socket.addEventListener('message', event => {
          try {
            const message = JSON.parse(String(event.data)) as EvaluateAnswer;
            if (message.id === 1) {
              resolve(message);
            }
          } catch {
            // A frame that is no answer of ours is not one to wait on.
          }
        });
        for (const ending of ['close', 'error'] as const) {
          socket.addEventListener(ending, () => {
            reject(
              new Error(
                `${owner}: the protocol connection ${ending === 'close' ? 'closed' : 'failed'} before the answer to ${excerptOf(expression)}`,
              ),
            );
          });
        }
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {expression, returnByValue: true, awaitPromise: true},
          }),
        );
      });
    } catch (caught) {
      if (
        caught instanceof NoAnswerError &&
        diagnosticsExpression !== undefined
      ) {
        // The bound fired, not the page: it may still answer an evaluate. Ask it once, briefly, for its trace.
        const left = await evaluateAt<string | null>(
          address,
          owner,
          diagnosticsExpression,
          DIAGNOSTICS_MILLISECONDS,
        )
          .then(value => String(value))
          .catch(() => undefined);
        if (left !== undefined && left !== 'null') {
          caught.message += `\n${owner} left: ${left}`;
        }
      }
      throw caught;
    }
    const failure =
      answer.error?.message ??
      answer.result?.exceptionDetails?.exception?.description ??
      answer.result?.exceptionDetails?.text;
    if (failure !== undefined) {
      throw new Error(`${owner}: ${failure}`);
    }
    return answer.result?.result?.value as Value;
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}

/** `read`'s value, or `unavailable` when the page did not answer in time; any other failure of the read stands. */
export async function unavailableWhenNoAnswer<Value>(
  read: Promise<Value>,
): Promise<Value | 'unavailable'> {
  try {
    return await read;
  } catch (caught) {
    if (caught instanceof NoAnswerError) {
      return 'unavailable';
    }
    throw caught;
  }
}
