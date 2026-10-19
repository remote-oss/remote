/** @fileoverview ResolutionStep: the names of the steps that can give the server archive's URL. */

/** The step that produced the URL. */
export type ResolutionStep = 'override' | 'productTemplate' | 'builtInTable';
