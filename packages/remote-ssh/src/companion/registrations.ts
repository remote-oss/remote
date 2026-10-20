/**
 * @fileoverview The disposal of several command registrations as one.
 */

import type {Registration} from 'lib-companion';

/** One registration whose disposal disposes every given one, once. */
export function allOf(registrations: readonly Registration[]): Registration {
  let disposed = false;
  return {
    dispose: () => {
      if (!disposed) {
        disposed = true;
        for (const registration of registrations) {
          registration.dispose();
        }
      }
    },
  };
}
