/**
 * @fileoverview The prompt surface of a connect: it listens to the notices of the connection lease, shows each
 * question `ssh` asks as the classifier chose (a pick for a host key, a masked input for everything else), and
 * answers through the lease. A question that another window answers first is taken down; a question the user
 * dismisses is refused through the lease, which refuses the rest of that ssh run by itself. While another window
 * holds the login it shows that it waits.
 */

import {classifyPrompt, type PromptSurface, type PromptText} from 'lib-ssh';
import type {LoginLease} from '../pipeline/connection-step.ts';
import {textOf, WAITING_TEMPLATE} from './prompt-strings.ts';
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
  /** Shows that this window waits for another one; the returned handle takes the text down. */
  showWaiting(text: string): {dispose(): void};
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

/** Starts showing the lease's questions. */
export function attachPromptSurface(
  lease: LoginLease,
  editor: PromptEditor,
  options: PromptSurfaceOptions,
): AttachedPromptSurface {
  const open = new Map<number, AbortController>();
  const state: {waiting: {dispose(): void} | undefined} = {waiting: undefined};

  function describe(text: PromptText): string {
    return textOf(text, editor.translate);
  }

  function stopWaiting(): void {
    state.waiting?.dispose();
    state.waiting = undefined;
  }

  function settle(promptId: number, answer: string | undefined): void {
    // A lease that has gone takes no answer; the connect then ends by itself.
    (answer === undefined
      ? lease.refuse(promptId)
      : lease.answer(promptId, answer)
    ).catch(() => false);
  }

  async function askUser(
    surface: PromptSurface,
    cancellation: AbortSignal,
  ): Promise<string | undefined> {
    if (surface.surface === 'maskedInput') {
      return editor.maskedInput(
        {placeholder: describe(surface.placeholder)},
        cancellation,
      );
    }
    return editor.pick(
      {
        title: describe(surface.title),
        placeholder: describe(surface.placeholder),
        items: surface.items.map(item => ({
          label: describe(item.label),
          answer: item.answer,
        })),
      },
      cancellation,
    );
  }

  async function show(promptId: number, text: string): Promise<void> {
    const surface = classifyPrompt(text, options.displayHost);
    const controller = new AbortController();
    open.set(promptId, controller);
    let answer: string | undefined;
    try {
      answer = await askUser(surface, controller.signal);
    } catch {
      // An editor that cannot show the question is the same as a user who dismissed it.
      answer = undefined;
    } finally {
      open.delete(promptId);
    }
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
        stopWaiting();
        void show(notice.promptId, notice.text);
        break;
      case 'promptClosed':
        open.get(notice.promptId)?.abort();
        open.delete(notice.promptId);
        break;
      case 'waitingForOtherWindow':
        stopWaiting();
        state.waiting = editor.showWaiting(editor.translate(WAITING_TEMPLATE));
        break;
      case 'ownerChanged':
        stopWaiting();
        break;
      default:
        stopWaiting();
        takeDownAll();
    }
  });

  return {
    dispose: () => {
      stopListening();
      stopWaiting();
      takeDownAll();
    },
  };
}
