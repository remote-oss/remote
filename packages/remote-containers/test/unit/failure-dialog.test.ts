import {deepStrictEqual} from 'node:assert';
import type {Failed, FailureReason} from 'lib-authority';
import type {DevContainerFolder} from '../../src/authority/payload.ts';
import {
  failureDialogOf,
  quickPickOf,
} from '../../src/surfaces/failure-dialog.ts';
import {
  FAILURE_TEMPLATES,
  reasonText,
} from '../../src/surfaces/failure-strings.ts';

function identity(template: string): string {
  return template;
}

const TARGET: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/w',
  localDocker: false,
  configFile: {
    $mid: 1,
    path: '/w/.devcontainer/devcontainer.json',
    scheme: 'file',
  },
};

/** A failure of `kind` that the dialog is asked to show. */
function failed(
  kind: string,
  reason?: FailureReason,
  diagnostics: readonly string[] = [],
): Failed {
  return {
    kind,
    ...(reason === undefined ? {} : {reason}),
    retryable: false,
    silent: false,
    userAlreadyNotified: false,
    hints: [],
    diagnostics,
  };
}

const RETRY = {label: 'Retry', action: 'retry'};
const EDIT = {
  label: 'Edit devcontainer.json Locally',
  action: 'editLocally',
  folder: TARGET,
};
const MORE = {label: 'More Actions...', action: 'moreActions'};

describe('the failure dialog (card containers-11)', () => {
  it("F-0410 AC-1: a setup failure's dialog has no message, the reason as detail, and Retry, Edit, More Actions", () => {
    deepStrictEqual(
      failureDialogOf(
        failed('containerSetupFailed', {id: 'S034'}),
        TARGET,
        identity,
      ),
      {
        message: '',
        detail: 'An error occurred setting up the container.',
        buttons: [RETRY, EDIT, MORE],
      },
    );
  });

  it('F-0410 AC-11, AC-12: S018 and S019 reach the detail', () => {
    deepStrictEqual(
      ['S018', 'S019'].map(
        stringId =>
          failureDialogOf(
            failed('containerSetupFailed', {id: stringId}),
            TARGET,
            identity,
          ).detail,
      ),
      [FAILURE_TEMPLATES.S018, FAILURE_TEMPLATES.S019],
    );
  });

  it("F-0202 AC-8, F-0201 AC-36, 7.E14, 7.E16: the second check's reasons use the same dialog", () => {
    deepStrictEqual(
      ['S144', 'S339', 'S104'].map(stringId =>
        failureDialogOf(
          failed('engineCheckFailed', {id: stringId}),
          TARGET,
          identity,
        ),
      ),
      [
        {
          message: '',
          detail: FAILURE_TEMPLATES.S144,
          buttons: [RETRY, EDIT, MORE],
        },
        {
          message: '',
          detail: FAILURE_TEMPLATES.S339,
          buttons: [RETRY, EDIT, MORE],
        },
        {
          message: '',
          detail: FAILURE_TEMPLATES.S104,
          buttons: [RETRY, EDIT, MORE],
        },
      ],
    );
  });

  it("F-0503 7.E1: the requirements failure has S346 as its message and the check's text as detail", () => {
    const dialog = failureDialogOf(
      failed('requirementsNotMet', {text: 'Error: Missing GLIBC'}),
      TARGET,
      identity,
    );
    deepStrictEqual(
      [dialog.message, dialog.detail],
      [FAILURE_TEMPLATES.S346, 'Error: Missing GLIBC'],
    );
  });

  it('F-0503 7.E3: an unsupported machine names its architecture, in the Alpine text or the other', () => {
    deepStrictEqual(
      [
        failed('unsupportedPlatform', {id: 'S031', values: ['armv7l']}),
        failed('unsupportedPlatform', {id: 'S359', values: ['armv7l']}),
      ].map(each => failureDialogOf(each, TARGET, identity).detail),
      [
        "Alpine Linux is not supported on the hardware architecture 'armv7l' of the container.",
        "The hardware architecture 'armv7l' of the container is not supported.",
      ],
    );
  });

  it('contracts: a value of a reason that is itself a string of the table is resolved in turn', () => {
    deepStrictEqual(
      failureDialogOf(
        failed('unsupportedPlatform', {
          id: 'S359',
          values: [{id: 'S297', values: []}],
        }),
        TARGET,
        identity,
      ).detail,
      "The hardware architecture 'Retry' of the container is not supported.",
    );
  });

  it('F-0410: a malformed authority has no Edit button and S034 as detail', () => {
    deepStrictEqual(
      failureDialogOf(failed('malformedAuthority'), undefined, identity),
      {
        message: '',
        detail: FAILURE_TEMPLATES.S034,
        buttons: [RETRY, MORE],
      },
    );
  });

  it("F-0503 7.E1: the requirements failure's buttons are Learn More, Edit and More Actions, with no Retry", () => {
    deepStrictEqual(
      failureDialogOf(
        failed('requirementsNotMet', {text: 'x'}),
        TARGET,
        identity,
      ).buttons,
      [{label: 'Learn More', action: 'learnMore'}, EDIT, MORE],
    );
  });

  it("F-0503 7.E1: without a target there's no Edit", () => {
    deepStrictEqual(
      failureDialogOf(
        failed('requirementsNotMet', {text: 'x'}),
        undefined,
        identity,
      ).buttons,
      [{label: 'Learn More', action: 'learnMore'}, MORE],
    );
  });

  it("F-0410 S158: {0} is the configuration's base name", () => {
    const target: DevContainerFolder = {
      ...TARGET,
      configFile: {$mid: 1, path: '/w/.devcontainer.json', scheme: 'file'},
    };
    deepStrictEqual(
      failureDialogOf(
        failed('containerSetupFailed', {id: 'S034'}),
        target,
        identity,
      ).buttons[1]?.label,
      'Edit .devcontainer.json Locally',
    );
  });

  it('R-26: no diagnostics reach the dialog', () => {
    const dialog = failureDialogOf(
      failed('containerSetupFailed', {id: 'S034'}, ['token=SECRET']),
      TARGET,
      identity,
    );
    deepStrictEqual(JSON.stringify(dialog).includes('SECRET'), false);
  });

  it('F-0202 AC-9: the quick pick', () => {
    deepStrictEqual(quickPickOf(TARGET, identity), {
      placeholder: 'Pick an action to help resolve the problem.',
      items: [
        {label: 'Reload Window', action: 'reload'},
        EDIT,
        {label: 'Open Recent...', action: 'openRecent'},
        {label: 'Open Documentation', action: 'openDocumentation'},
      ],
    });
  });

  it('F-0410: the quick pick without a target', () => {
    deepStrictEqual(
      quickPickOf(undefined, identity).items.map(item => item.label),
      ['Reload Window', 'Open Recent...', 'Open Documentation'],
    );
  });
});

describe('the text of a failure’s reason (card containers-11)', () => {
  it('contracts: a failure with no reason has no text', () => {
    deepStrictEqual(
      [
        reasonText(undefined, template => template),
        reasonText({text: 'x'}, template => template),
      ],
      ['', 'x'],
    );
  });
});
