import {deepStrictEqual} from 'node:assert';
import {NOISE_LINES} from 'lib-host/testing/noise';
import {classifyPrompt} from '../../src/index.ts';
import type {PickItem, PromptSurface} from '../../src/index.ts';

/** The host the question is displayed for. */
const DISPLAY_HOST = 'myalias';

/** The line that opens a host-key question, with its line end. */
const AUTHENTICITY =
  "The authenticity of host 'h.invalid (192.0.2.1)' can't be established.\n";

/** The question line that closes a host-key question. */
const CONTINUE =
  'Are you sure you want to continue connecting (yes/no/[fingerprint])? ';

/** The classic fingerprint line the pick rules read. */
const CLASSIC_LINE = 'ED25519 key fingerprint is SHA256:x.';

const WARNING_LINE = 'WARNING: the key for IP differs.';
const OFFENDING_LINE = 'Offending key for IP in /home/dev/.ssh/known_hosts:3';
const MATCHING_LINE = 'Matching host key in /home/dev/.ssh/known_hosts:5';

/** The question line of the differing-key rows. */
const CONTINUE_SHORT =
  'Are you sure you want to continue connecting (yes/no)? ';

const AC8_TEXT = `${AUTHENTICITY}ED25519 key fingerprint is SHA256:abcDEF123+/xyz.
This key is not known by any other names.
${CONTINUE}`;

/** The two items every pick carries, in answer order. */
function pickItems(): PickItem[] {
  return [
    {label: {id: 'S028', values: []}, answer: 'yes'},
    {label: {id: 'S015', values: []}, answer: 'no'},
  ];
}

/** The fingerprint pick the row's notation calls PICK(host, fingerprint). */
function pick(host: string, fingerprint: string): PromptSurface {
  return {
    surface: 'fingerprintPick',
    title: {id: 'S001', values: [host, fingerprint]},
    placeholder: {id: 'S013', values: []},
    items: pickItems(),
  };
}

/** The continuation pick with one title text. */
function continuation(titleText: string): PromptSurface {
  return {
    surface: 'continuationPick',
    title: {text: titleText},
    placeholder: {id: 'S012', values: []},
    items: pickItems(),
  };
}

/** The masked input the row's notation calls MASK(text). */
function masked(text: string): PromptSurface {
  return {surface: 'maskedInput', placeholder: {text}};
}

describe('classifyPrompt (the surface a question is shown on)', () => {
  it('F-2305.AC-8: the known fingerprint and the question are a pick', () => {
    deepStrictEqual(
      classifyPrompt(AC8_TEXT, DISPLAY_HOST),
      pick(DISPLAY_HOST, 'SHA256:abcDEF123+/xyz'),
    );
  });

  it('ADR-0010: the prompt classifier: noise around and inside its stream changes nothing', () => {
    const noise = `${NOISE_LINES.join('\n')}\n`;
    deepStrictEqual(
      classifyPrompt(
        `${noise}${AUTHENTICITY}${noise}ED25519 key fingerprint is SHA256:abcDEF123+/xyz.\n${noise}This key is not known by any other names.\n${noise}${CONTINUE}`,
        DISPLAY_HOST,
      ),
      pick(DISPLAY_HOST, 'SHA256:abcDEF123+/xyz'),
    );
  });

  const FINGERPRINT_TYPES = ['RSA', 'ECDSA', 'ECDSA-SK', 'ED25519'] as const;
  for (const keyType of FINGERPRINT_TYPES) {
    it(`F-2305.BR-2: a ${keyType} fingerprint line is a pick`, () => {
      const text = `${keyType} key fingerprint is SHA256:x.\n${CONTINUE}`;
      deepStrictEqual(
        classifyPrompt(text, DISPLAY_HOST),
        pick(DISPLAY_HOST, 'SHA256:x'),
      );
    });
  }

  const QUESTION_FORMS: Array<[string, string]> = [
    [
      'the choice list',
      'Are you sure you want to continue connecting (yes/no)? ',
    ],
    ['no choice list', 'Are you sure you want to continue connecting?'],
  ];
  for (const [label, question] of QUESTION_FORMS) {
    it(`F-2305.BR-2: the question with ${label} closes the pick`, () => {
      const text = `${CLASSIC_LINE}\n${question}`;
      deepStrictEqual(
        classifyPrompt(text, DISPLAY_HOST),
        pick(DISPLAY_HOST, 'SHA256:x'),
      );
    });
  }

  it('F-2305.AC-10: an MD5 fingerprint is a pick', () => {
    const text = `RSA key fingerprint is MD5:aa:bb:cc.\n${CONTINUE}`;
    deepStrictEqual(
      classifyPrompt(text, DISPLAY_HOST),
      pick(DISPLAY_HOST, 'MD5:aa:bb:cc'),
    );
  });

  it('F-2305.AC-9: the display host leads the title values', () => {
    deepStrictEqual(
      classifyPrompt(AC8_TEXT, 'host.example'),
      pick('host.example', 'SHA256:abcDEF123+/xyz'),
    );
  });

  const NEWER_FORMS: Array<[string, string]> = [
    ['no full stop', 'ED25519 key fingerprint is SHA256:abc'],
    ['the colon and the full stop', 'ED25519 key fingerprint is: SHA256:abc.'],
    ['the colon and no full stop', 'ED25519 key fingerprint is: SHA256:abc'],
  ];
  for (const [label, line] of NEWER_FORMS) {
    it(`F-2305.AC-43, BR-2: a fingerprint line with ${label} is a pick`, () => {
      const text = `${AUTHENTICITY}${line}\n${CONTINUE}`;
      deepStrictEqual(
        classifyPrompt(text, DISPLAY_HOST),
        pick(DISPLAY_HOST, 'SHA256:abc'),
      );
    });
  }

  it('F-2305.BR-2: the question OpenSSH 10.3 writes, verbatim, is a pick of its fingerprint', () => {
    const text = `The authenticity of host '[127.0.0.1]:42455 ([127.0.0.1]:42455)' can't be established.
ED25519 key fingerprint is: SHA256:228bbRdDH1k3dCptOWPoMMTsL/eCbdUeT5wekJmgEpY
This key is not known by any other names.
${CONTINUE}`;
    deepStrictEqual(
      classifyPrompt(text, '127.0.0.1'),
      pick('127.0.0.1', 'SHA256:228bbRdDH1k3dCptOWPoMMTsL/eCbdUeT5wekJmgEpY'),
    );
  });

  it('F-2305.BR-2: a fingerprint line without a key type is still no pick', () => {
    const text = `${AUTHENTICITY}key fingerprint is: SHA256:abc\n${CONTINUE}`;
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(` ${text}`));
  });

  it('F-2305.BR-2: the fingerprint line alone is a masked input', () => {
    deepStrictEqual(
      classifyPrompt(CLASSIC_LINE, DISPLAY_HOST),
      masked(` ${CLASSIC_LINE}`),
    );
  });

  const LINES_WITHOUT_QUESTION: Array<[string, string]> = [
    ['the classic form', 'ED25519 key fingerprint is SHA256:abc.'],
    [
      'the form with a colon and no full stop',
      'ED25519 key fingerprint is: SHA256:abc',
    ],
    [
      'the form with a colon and a full stop',
      'ED25519 key fingerprint is: SHA256:abc.',
    ],
  ];
  for (const [label, line] of LINES_WITHOUT_QUESTION) {
    it(`F-2305.BR-2: ${label} without the continue-connecting question stays a masked input`, () => {
      const text = `${AUTHENTICITY}${line}\n`;
      deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(` ${text}`));
    });
  }

  it('F-2305.BR-2: the question alone is a masked input', () => {
    deepStrictEqual(
      classifyPrompt(CONTINUE, DISPLAY_HOST),
      masked(` ${CONTINUE}`),
    );
  });

  it('F-2305.BR-2: the question before the fingerprint line is a masked input', () => {
    const text = `${CONTINUE}\n${CLASSIC_LINE}`;
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(` ${text}`));
  });

  it('F-2305.AC-39: the differing key lines are a continuation pick', () => {
    const text = `${WARNING_LINE}\n${OFFENDING_LINE}\n${MATCHING_LINE}\n${CONTINUE_SHORT}`;
    deepStrictEqual(
      classifyPrompt(text, DISPLAY_HOST),
      continuation(`${WARNING_LINE}\n${OFFENDING_LINE}\n${MATCHING_LINE}`),
    );
  });

  it('F-2305.BR-2: the differing key lines without the warning are a continuation pick', () => {
    const text = `${OFFENDING_LINE}\n${MATCHING_LINE}\n${CONTINUE_SHORT}`;
    deepStrictEqual(
      classifyPrompt(text, DISPLAY_HOST),
      continuation(`${OFFENDING_LINE}\n${MATCHING_LINE}`),
    );
  });

  const LONE_LINES: Array<[string, string]> = [
    ['the warning line', `${WARNING_LINE}\n${CONTINUE_SHORT}`],
    ['the offending line', `${OFFENDING_LINE}\n${CONTINUE_SHORT}`],
  ];
  for (const [label, text] of LONE_LINES) {
    it(`F-2305.BR-2: ${label} with the question is a masked input`, () => {
      deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(` ${text}`));
    });
  }

  it('F-2305.BR-2: the fingerprint line wins over the differing key lines', () => {
    const text = `${CLASSIC_LINE}\n${OFFENDING_LINE}\n${MATCHING_LINE}\n${CONTINUE_SHORT}`;
    deepStrictEqual(
      classifyPrompt(text, DISPLAY_HOST),
      pick(DISPLAY_HOST, 'SHA256:x'),
    );
  });

  it('F-2307.BR-3: the passphrase question is the passphrase placeholder', () => {
    deepStrictEqual(
      classifyPrompt(
        "Enter passphrase for key '/home/dev/.ssh/id_ed25519': ",
        DISPLAY_HOST,
      ),
      {surface: 'maskedInput', placeholder: {id: 'S064', values: ['']}},
    );
  });

  it('F-2307.BR-3: the agent question is masked as written', () => {
    const text = ' Add key /home/dev/.ssh/id_x (comment) to agent? ';
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(text));
  });

  const S066_QUESTIONS: Array<[string, string]> = [
    ["lab@127.0.0.1's password: ", 'lab@127.0.0.1'],
    ["Login for bob's password: ", 'bob'],
    [" (lab@h) lab@h's password: ", 'lab@h'],
    ["lab@h's password:", 'lab@h'],
  ];
  for (const [text, value] of S066_QUESTIONS) {
    it(`F-2306.BR-2: the password question of ${value} is the S066 placeholder`, () => {
      deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), {
        surface: 'maskedInput',
        placeholder: {id: 'S066', values: [value]},
      });
    });
  }

  const S065_QUESTIONS: Array<[string, string]> = [
    ['Password: ', 'the bare password question'],
    ['Password:', 'the password without a space'],
    ['Your Password: ', 'a word before the password question'],
    ['Password: (or press Enter) ', 'the password with a note'],
    [
      'Password: Verification code: ',
      'the password before a verification code',
    ],
  ];
  for (const [text, label] of S065_QUESTIONS) {
    it(`F-2306.BR-2: ${label} is the S065 placeholder`, () => {
      deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), {
        surface: 'maskedInput',
        placeholder: {id: 'S065', values: []},
      });
    });
  }

  it('F-2306.BR-2: the password question wins over the verification code', () => {
    const text = "lab@h's password: Verification code: ";
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), {
      surface: 'maskedInput',
      placeholder: {id: 'S066', values: ['lab@h']},
    });
  });

  const CODE_QUESTIONS: Array<[string, string]> = [
    ['Verification code: ', 'the bare code question'],
    ['Verification code:', 'the code question without a space'],
    ['Verification code: (6 digits) ', 'the code question with a digit note'],
  ];
  for (const [text, label] of CODE_QUESTIONS) {
    it(`F-2306.BR-2: ${label} is the code placeholder`, () => {
      deepStrictEqual(
        classifyPrompt(text, DISPLAY_HOST),
        masked('Enter verification code'),
      );
    });
  }

  const SPACED_QUESTIONS: Array<[string, string]> = [
    [' password: ', 'a lower-case password question'],
    [' Password for lab: ', 'the password for a name'],
    [' Verification Code: ', 'a capital C code question'],
    [' verification code: ', 'a lower-case code question'],
    [' Verification code for lab: ', 'the code for a name'],
    [' OTP: ', 'an otp question'],
    [' Current password:', 'the current password'],
    [' New password:', 'the new password'],
    [' Retype new password:', 'the retype question'],
    [
      ' Changing password for lab.\nCurrent password: ',
      'a password change with two lines',
    ],
  ];
  for (const [text, label] of SPACED_QUESTIONS) {
    it(`F-2306.BR-2: ${label} is masked as written`, () => {
      deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(text));
    });
  }

  it('F-2307.BR-3: a passphrase question for a path is masked with a leading space', () => {
    const text = 'Enter passphrase for /home/dev/.ssh/id_x: ';
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(` ${text}`));
  });

  it('F-2307.BR-3: a PIN question for a key is masked with a leading space', () => {
    const text = 'Enter PIN for ED25519-SK key /home/dev/.ssh/id_sk: ';
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(` ${text}`));
  });

  it('F-2306.BR-2.4 (provisional): a spaced code question stays unchanged', () => {
    const text = ' Verification code for x: ';
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), masked(text));
  });

  it('S6 rule 5 (provisional): the empty text is a single space', () => {
    deepStrictEqual(classifyPrompt('', DISPLAY_HOST), masked(' '));
  });

  it("F-2306.BR-2.1 (provisional): a bare 's password question is the S066 placeholder", () => {
    const text = "'s password: ";
    deepStrictEqual(classifyPrompt(text, DISPLAY_HOST), {
      surface: 'maskedInput',
      placeholder: {id: 'S066', values: ['']},
    });
  });
});
