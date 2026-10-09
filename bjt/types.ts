/**
 * The shape the pipeline's data travels in, named once.
 *
 * An item (and a bundle) is parsed JSON and moves through the pipeline as a
 * plain object. This module imports nothing, so the modules underneath the
 * generators (batch.ts, the fidelity checks, the voice plan) can name the
 * type without importing generators/base.ts, which imports them.
 */

/** An item as the model writes it and the pipeline passes it on: plain JSON. */
export type Item = Record<string, any>;
