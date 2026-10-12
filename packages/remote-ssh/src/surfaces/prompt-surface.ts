/**
 * @fileoverview The prompt surface of a connect: it listens to the notices of the connection lease, shows each
 * question `ssh` asks as the classifier chose (a pick for a host key, a masked input for everything else), and
 * answers through the lease. A question that another window answers first is taken down; a question the user
 * dismisses is refused through the lease, which refuses the rest of that ssh run by itself. While another window
 * holds the login it shows that it waits.
 */

import {classifyPrompt, type PromptSurface, type PromptText} from 'lib-ssh';
import type {LoginLease} from '../pipeline/connection-step.ts';
import {textOf} from './prompt-strings.ts';
import type {Translate} from './strings.ts';

/** One pick as the editor shows it. */
export interface PickRequest {
  /** The title above the choices, absent for a question with none. */
  title?: string;
  placeholder: string;
  items: ReadonlyArray<{label: string; answer: 'yes' | 'no'}>;
}

/** What the surface needs of the editor. */
export interface PromptEditor {
  /**
   * Shows a pick that closes when the user looks away. Gives the answer of the chosen item, or undefined when the
   * user dismissed it or the signal ended it.
   */
  pick(
    request: PickRequest,
    cancellation: AbortSignal,
  ): Promise<'yes' | 'no' | undefined>;
  /**
   * Shows a masked input that stays open when the user looks away. Gives the typed text, or undefined when the user
   * cancelled it or the signal ended it.
   */
  maskedInput(
    request: {placeholder: string},
    cancellation: AbortSignal,
  ): Promise<string | undefined>;
  /** The text for the display language of a template. */
  translate: Translate;
}

/** What one connect tells the surface about itself. */
export interface PromptSurfaceOptions {
  /** The host as the user named it, which the fingerprint question names. */
  displayHost: string;
}

/** The surface once attached: ending it takes down what it shows and stops listening. */
export interface AttachedPromptSurface {
  dispose(): void;
}

/** The text of a prompt part in the display language. */
function describe(editor: PromptEditor, text: PromptText): string {
  return textOf(text, editor.translate);
}

/**
 * Shows one question as the classifier chooses (a pick for a host key, a masked input otherwise) and gives the user's
 * answer, or nothing when it was dismissed, the signal ended it, or the editor could not show it.
 */
export async function askQuestion(
  editor: PromptEditor,
  text: string,
  displayHost: string,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  try {
    return await askUser(
      editor,
      classifyPrompt(text, displayHost),
      cancellation,
    );
  } catch {
    // An editor that cannot show the question is the same as a user who dismissed it.
    return undefined;
  }
}

/** The answer of one shown question, as the classifier chose: a pick or a masked input. */
async function askUser(
  editor: PromptEditor,
  surface: PromptSurface,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  if (surface.surface === 'maskedInput') {
    return editor.maskedInput(
      {placeholder: describe(editor, surface.placeholder)},
      cancellation,
    );
  }
  return editor.pick(
    {
      title: describe(editor, surface.title),
      placeholder: describe(editor, surface.placeholder),
      items: surface.items.map(item => ({
        label: describe(editor, item.label),
        answer: item.answer,
      })),
    },
    cancellation,
  );
}

/** Starts showing the lease's questions. */
export function attachPromptSurface(
  lease: LoginLease,
  editor: PromptEditor,
  options: PromptSurfaceOptions,
): AttachedPromptSurface {
  const open = new Map<number, AbortController>();

  function settle(promptId: number, answer: string | undefined): void {
    // A lease that has gone takes no answer; the connect then ends by itself.
    (answer === undefined
      ? lease.refuse(promptId)
      : lease.answer(promptId, answer)
    ).catch(() => false);
  }

  async function show(promptId: number, text: string): Promise<void> {
    const controller = new AbortController();
    open.set(promptId, controller);
    const answer = await askQuestion(
      editor,
      text,
      options.displayHost,
      controller.signal,
    );
    open.delete(promptId);
    if (!controller.signal.aborted) {
      settle(promptId, answer);
    }
  }

  function takeDownAll(): void {
    for (const controller of open.values()) {
      controller.abort();
    }
    open.clear();
  }

  const stopListening = lease.onNotice(notice => {
    switch (notice.type) {
      case 'prompt':
        void show(notice.promptId, notice.text);
        break;
      case 'promptClosed':
        open.get(notice.promptId)?.abort();
        open.delete(notice.promptId);
        break;
      case 'waitingForOtherWindow':
      case 'ownerChanged':
      case 'loginOwned':
        break;
      default:
        takeDownAll();
    }
  });

  return {
    dispose: () => {
      stopListening();
      takeDownAll();
    },
  };
}
