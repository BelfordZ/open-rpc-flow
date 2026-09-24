import Ajv from 'ajv';
import type { Flow, Step } from '../types';
import {
  isConditionStep,
  isLoopStep,
  isRequestStep,
  isSwitchCondition,
} from '../step-executors/types';
import {
  FlowDiagnostic,
  FlowDiagnosticCode,
  OpenRpcDocument,
  OpenRpcMethodDescriptor,
} from './types';

/**
 * Special variables the expression evaluator resolves without a step name.
 * Mirrors SafeExpressionEvaluator's special-variable list.
 */
const SPECIAL_VARIABLES = new Set(['item', 'context', 'acc']);

/**
 * Extracts the inner paths of every `${...}` reference in a string,
 * handling nested `${...}` spans. Unbalanced spans are ignored.
 */
export function extractReferencePaths(value: string): string[] {
  const paths: string[] = [];
  let pos = 0;
  while (pos < value.length) {
    const start = value.indexOf('${', pos);
    if (start === -1) {
      break;
    }
    let depth = 1;
    let i = start + 2;
    while (i < value.length && depth > 0) {
      if (value.startsWith('${', i)) {
        depth++;
        i += 2;
      } else if (value[i] === '}') {
        depth--;
        i++;
      } else {
        i++;
      }
    }
    if (depth === 0) {
      paths.push(value.substring(start + 2, i - 1).trim());
      pos = i;
    } else {
      break;
    }
  }
  return paths;
}

/**
 * The base name of a reference path: the part before the first `.`,
 * `[`, or whitespace, e.g. `getUser` in `getUser.result.id`.
 */
export function referenceBase(path: string): string {
  return path.split(/[[.\s]+/)[0];
}

/**
 * Splits a reference path into segments, handling dot and bracket notation:
 * `a.b['c d'].e` -> ['a', 'b', 'c d', 'e'].
 */
export function splitPathSegments(path: string): string[] {
  const segments: string[] = [];
  let current = '';
  let i = 0;
  const push = (): void => {
    if (current.length > 0) {
      segments.push(current);
      current = '';
    }
  };
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      push();
      i++;
    } else if (ch === '[') {
      push();
      i++;
      // Quoted key: ['name'] or ["name"]
      if (path[i] === '"' || path[i] === "'") {
        const quote = path[i];
        i++;
        let key = '';
        while (i < path.length && path[i] !== quote) {
          key += path[i];
          i++;
        }
        segments.push(key);
        // Skip to closing bracket
        while (i < path.length && path[i] !== ']') {
          i++;
        }
        i++; // consume ']'
      } else {
        // Numeric index or bare key: [0], [name]
        let key = '';
        while (i < path.length && path[i] !== ']') {
          key += path[i];
          i++;
        }
        segments.push(key.trim());
        i++; // consume ']'
      }
    } else {
      current += ch;
      i++;
    }
  }
  push();
  return segments;
}

/**
 * Classic Levenshtein edit distance.
 */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, i) => [
    i,
    ...Array(cols - 1).fill(0),
  ]);
  for (let j = 1; j < cols; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Finds the closest candidate to `name` within an edit distance of 2.
 * Returns undefined when nothing is close enough to suggest.
 */
export function didYouMean(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate === name) {
      continue;
    }
    const distance = levenshtein(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

/**
 * True when a param value (or anything nested inside it) is a dynamic
 * expression that cannot be checked statically.
 */
function isDynamic(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('${');
  }
  if (Array.isArray(value)) {
    return value.some(isDynamic);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(isDynamic);
  }
  return false;
}

interface ScopedStep {
  step: Step;
  /** Loop `as` variable names in scope for this step. */
  scopeVars: string[];
}

/**
 * Yields every step in the flow, including steps nested in loops and
 * condition branches, along with the loop variables in scope.
 */
function* walkSteps(steps: Step[], scopeVars: string[]): Generator<ScopedStep> {
  for (const step of steps) {
    yield { step, scopeVars };
    if (isLoopStep(step)) {
      const inner: Step[] = [];
      if (step.loop.steps) {
        inner.push(...step.loop.steps);
      } else if (step.loop.step) {
        inner.push(step.loop.step);
      }
      const innerScope = step.loop.as ? [...scopeVars, step.loop.as] : scopeVars;
      yield* walkSteps(inner, innerScope);
    } else if (isConditionStep(step)) {
      const condition = step.condition;
      const branches: Step[] = [];
      if (isSwitchCondition(condition)) {
        for (const caseValue of Object.values(condition.cases ?? {})) {
          branches.push(...(Array.isArray(caseValue) ? caseValue : [caseValue]));
        }
        if (condition.default !== undefined) {
          branches.push(
            ...(Array.isArray(condition.default) ? condition.default : [condition.default]),
          );
        }
      } else {
        if (condition.then !== undefined) {
          branches.push(condition.then);
        }
        if (condition.else !== undefined) {
          branches.push(condition.else);
        }
      }
      yield* walkSteps(branches, scopeVars);
    }
  }
}

/**
 * Collects every string in a step that may carry a `${...}` reference.
 *
 * Excluded from the scan:
 * - `name` and `description`: labels, not expressions; scanning them would
 *   flag documentation examples as broken references.
 * - `method`: request method names are sent literally (never interpolated),
 *   so `${...}` there is reported as UNKNOWN_METHOD, not as a step reference.
 * - Nested step subtrees (`loop.step`, `loop.steps`, `condition.then`,
 *   `condition.else`, `condition.cases`, `condition.default`): nested steps are
 *   validated separately with their own scope (e.g. loop variables); scanning
 *   them here would double-report.
 */
function* referenceStrings(step: Step): Generator<string> {
  const EXCLUDED_KEYS = new Set(['name', 'description', 'method']);
  interface Frame {
    key?: string;
    parentKey?: string;
    value: unknown;
  }
  const stack: Frame[] = [{ value: step }];
  while (stack.length > 0) {
    const { key, parentKey, value } = stack.pop() as Frame;
    // Don't descend into nested steps; they are validated with their own scope.
    if (
      (parentKey === 'loop' && (key === 'step' || key === 'steps')) ||
      (parentKey === 'condition' &&
        (key === 'then' || key === 'else' || key === 'cases' || key === 'default'))
    ) {
      continue;
    }
    if (typeof value === 'string') {
      if (!EXCLUDED_KEYS.has(key as string) && value.includes('${')) {
        yield value;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        stack.push({ key, parentKey, value: item });
      }
    } else if (value !== null && typeof value === 'object') {
      for (const [entryKey, entryValue] of Object.entries(value)) {
        stack.push({ key: entryKey, parentKey: key, value: entryValue });
      }
    }
  }
}

/**
 * Statically validates a flow against a single OpenRPC document.
 *
 * This is the semantic layer on top of the structural `meta-schema.json`
 * validation: it checks that request steps call methods that exist, that
 * static params conform to the method's param schemas, and that every
 * `${step…}` reference resolves to a real step.
 *
 * Returns a list of step-scoped diagnostics; an empty list means the flow
 * is healthy. Diagnostics with severity `'error'` would fail at runtime;
 * `'warning'` diagnostics are suspicious but tolerable (e.g. loose schemas).
 */
export function validateFlow(flow: Flow, openrpcDocument: OpenRpcDocument): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const ajv = new Ajv({ strict: false });

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  const scopedSteps = [...walkSteps(steps, [])];
  const stepNames = scopedSteps.map(({ step }) => step.name);
  const stepByName = new Map<string, Step>();
  const seenNames = new Set<string>();

  for (const { step } of scopedSteps) {
    if (seenNames.has(step.name)) {
      diagnostics.push({
        step: step.name,
        severity: 'error',
        code: FlowDiagnosticCode.DUPLICATE_STEP_NAME,
        message: `Duplicate step name '${step.name}': references to it would be ambiguous.`,
      });
    } else {
      seenNames.add(step.name);
      stepByName.set(step.name, step);
    }
  }

  const methods = Array.isArray(openrpcDocument.methods) ? openrpcDocument.methods : [];
  const methodByName = new Map<string, OpenRpcMethodDescriptor>();
  for (const method of methods) {
    if (typeof method?.name === 'string') {
      methodByName.set(method.name, method);
    }
  }
  const methodNames = [...methodByName.keys()];

  const checkParams = (
    stepName: string,
    params: unknown,
    method: OpenRpcMethodDescriptor,
  ): void => {
    const methodParams = Array.isArray(method.params) ? method.params : [];
    if (Array.isArray(params)) {
      // By-position params.
      const requiredCount = methodParams.filter((p) => p.required !== false).length;
      if (params.length < requiredCount) {
        diagnostics.push({
          step: stepName,
          severity: 'error',
          code: FlowDiagnosticCode.MISSING_REQUIRED_PARAM,
          message:
            `Method '${method.name}' requires at least ${requiredCount} param(s) ` +
            `but the step provides ${params.length} positional param(s).`,
        });
      }
      params.forEach((value, index) => {
        const descriptor = methodParams[index];
        if (!descriptor?.schema || isDynamic(value)) {
          return;
        }
        let validate: ReturnType<Ajv['compile']>;
        try {
          validate = ajv.compile(descriptor.schema as object);
        } catch {
          return; // Broken schema in the document; not the flow's fault.
        }
        if (!validate(value)) {
          diagnostics.push({
            step: stepName,
            severity: 'error',
            code: FlowDiagnosticCode.PARAM_SCHEMA_MISMATCH,
            message:
              `Positional param ${index + 1} of method '${method.name}' ` +
              `does not match its schema: ${ajv.errorsText(validate.errors)}.`,
          });
        }
      });
      return;
    }
    if (params !== null && typeof params === 'object') {
      const record = params as Record<string, unknown>;
      for (const descriptor of methodParams) {
        const value = record[descriptor.name];
        if (value === undefined) {
          if (descriptor.required !== false) {
            diagnostics.push({
              step: stepName,
              severity: 'error',
              code: FlowDiagnosticCode.MISSING_REQUIRED_PARAM,
              message:
                `Method '${method.name}' requires param '${descriptor.name}' ` +
                `but the step does not provide it.`,
            });
          }
          continue;
        }
        if (!descriptor.schema || isDynamic(value)) {
          continue;
        }
        let validate: ReturnType<Ajv['compile']>;
        try {
          validate = ajv.compile(descriptor.schema as object);
        } catch {
          continue; // Broken schema in the document; not the flow's fault.
        }
        if (!validate(value)) {
          diagnostics.push({
            step: stepName,
            severity: 'error',
            code: FlowDiagnosticCode.PARAM_SCHEMA_MISMATCH,
            message:
              `Param '${descriptor.name}' of method '${method.name}' ` +
              `does not match its schema: ${ajv.errorsText(validate.errors)}.`,
          });
        }
      }
    }
  };

  const checkReferences = (stepName: string, scopeVars: string[]): void => {
    // stepName always comes from the same walk that built stepByName.
    const step = stepByName.get(stepName) as Step;
    const knownNames = new Set([...stepNames, ...scopeVars]);
    for (const value of referenceStrings(step)) {
      for (const path of extractReferencePaths(value)) {
        const base = referenceBase(path);
        if (base.length === 0 || SPECIAL_VARIABLES.has(base)) {
          continue;
        }
        if (!knownNames.has(base)) {
          const suggestion = didYouMean(base, stepNames);
          diagnostics.push({
            step: stepName,
            severity: 'error',
            code: FlowDiagnosticCode.UNKNOWN_STEP_REFERENCE,
            message:
              `Reference '\${${path}}' points to unknown step '${base}'.` +
              (suggestion ? ` Did you mean '${suggestion}'?` : ''),
          });
          continue;
        }
        checkResultProperty(stepName, base, path);
      }
    }
  };

  const checkResultProperty = (stepName: string, base: string, path: string): void => {
    // segments[0] is the step name itself; only `${step.result.prop…}` can be
    // checked against the document. Anything else reaches into
    // StepExecutionResult internals, which have no document schema.
    const segments = splitPathSegments(path);
    if (segments[1] !== 'result' || segments.length < 3) {
      return;
    }
    const target = stepByName.get(base);
    if (!target || !isRequestStep(target)) {
      return;
    }
    const methodName = target.request.method;
    if (typeof methodName !== 'string' || methodName.includes('${')) {
      return;
    }
    const method = methodByName.get(methodName);
    const schema = method?.result?.schema as { properties?: Record<string, unknown> } | undefined;
    if (!schema || typeof schema !== 'object' || !schema.properties) {
      return; // Unknown or loose result schema: nothing to check against.
    }
    const prop = segments[2];
    if (!(prop in schema.properties)) {
      diagnostics.push({
        step: stepName,
        severity: 'warning',
        code: FlowDiagnosticCode.UNKNOWN_RESULT_PROPERTY,
        message:
          `Reference '\${${path}}' reads property '${prop}', which is not ` +
          `declared in the result schema of method '${methodName}'.`,
      });
    }
  };

  for (const { step, scopeVars } of scopedSteps) {
    if (isRequestStep(step)) {
      const methodName = step.request.method;
      // Note: method names are sent literally (never interpolated), so a
      // `${...}` method name is reported as unknown rather than skipped.
      if (typeof methodName === 'string') {
        const method = methodByName.get(methodName);
        if (!method) {
          const suggestion = didYouMean(methodName, methodNames);
          diagnostics.push({
            step: step.name,
            severity: 'error',
            code: FlowDiagnosticCode.UNKNOWN_METHOD,
            message:
              `Method '${methodName}' is not defined in the OpenRPC document.` +
              (suggestion ? ` Did you mean '${suggestion}'?` : ''),
          });
        } else {
          checkParams(step.name, step.request.params, method);
        }
      }
    }
    checkReferences(step.name, scopeVars);
  }

  return diagnostics;
}
