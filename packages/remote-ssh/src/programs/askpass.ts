/**
 * @fileoverview The askpass program that `ssh` runs to ask for a password, a passphrase or a confirmation: it hands the
 * question to the helper's askpass endpoint and prints the answer on standard output. It loads nothing of the editor.
 */

import {runAskpassMain} from 'lib-helper';

void runAskpassMain(process);
