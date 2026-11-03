/**
 * @fileoverview The askpass program git and ssh run during a clone's check on this machine: it hands the question to
 * the extension's relay and prints the answer. A program that can't reach the relay refuses, so git stops asking.
 */

import {runAskpassMain} from 'lib-helper';

void runAskpassMain(process);
