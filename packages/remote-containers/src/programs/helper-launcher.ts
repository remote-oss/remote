/**
 * @fileoverview The launcher of the shutdown helper: a program of its own that starts the helper outside the process
 * tree of the window that asked for it, so the helper outlives everything that ends that window, and exits. The
 * extension starts it with the helper's script as its only argument; it loads nothing of the editor.
 */

import {runTreeLeavingLauncher} from 'lib-helper';

runTreeLeavingLauncher();
