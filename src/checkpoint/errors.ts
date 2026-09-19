import { FlowError } from '../errors/base';
import { ErrorCode } from '../errors/codes';

/**
 * Error thrown for checkpoint incompatibility or un-checkpointable state:
 * version mismatches, flow-definition mismatches, and state that cannot be
 * serialized to JSON. Malformed checkpoint *input* (not an object, wrong
 * field types) is a {@link ValidationError} instead.
 */
export class CheckpointError<
  C extends Record<string, unknown> = Record<string, unknown>,
> extends FlowError<C> {
  constructor(message: string, context: C, code: ErrorCode) {
    super(message, code, context);
    this.name = 'CheckpointError';
    Object.setPrototypeOf(this, CheckpointError.prototype);
  }
}
