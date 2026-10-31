/**
 * @fileoverview A quick pick for the rows of the template pick and of the wizard: it records what the pick sets and lets a
 * row play the user.
 */

import type {TemplatePicker} from '../../src/authoring/template-pick.ts';
import {FakeQuickPick} from './quick-pick.fixture.ts';

/** A row of the template picker. */
export type Row = TemplatePicker['items'][number];

/** A quick pick that records what the pick sets and lets a row play the user. */
export class FakePicker extends FakeQuickPick<Row> implements TemplatePicker {
  matchOnDetail = true;
}
