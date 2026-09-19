/**
 * Schema-driven mock value generation for the mock JSON-RPC handler.
 * See issue #152.
 *
 * Generation is best-effort: for any schema shape this module cannot make
 * sense of (unknown types, `$ref`s, boolean schemas, non-objects), it
 * returns `null` rather than throwing, so a dry run never crashes on an
 * unusual document.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Random lowercase alphanumeric fragment, e.g. for emails and hostnames. */
function randomFragment(rand: () => number, length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(rand() * chars.length)];
  }
  return out;
}

/** Random UUID v4, drawing all nibbles from the seeded PRNG. */
function randomUuid(rand: () => number): string {
  const hex = (): string => Math.floor(rand() * 16).toString(16);
  const section = (n: number): string => Array.from({ length: n }, hex).join('');
  return `${section(8)}-${section(4)}-4${section(3)}-${['8', '9', 'a', 'b'][Math.floor(rand() * 4)]}${section(3)}-${section(12)}`;
}

/** Deterministic timestamp base: 2000-01-01T00:00:00Z plus a random offset. */
function randomTimestamp(rand: () => number): Date {
  return new Date(946684800000 + Math.floor(rand() * 1000000000000));
}

function generateString(schema: Record<string, unknown>, rand: () => number): string {
  const format = typeof schema.format === 'string' ? schema.format : undefined;
  const frag = randomFragment(rand, 8);
  let value: string;
  switch (format) {
    case 'date-time':
      value = randomTimestamp(rand).toISOString();
      break;
    case 'date':
      value = randomTimestamp(rand).toISOString().slice(0, 10);
      break;
    case 'time':
      value = randomTimestamp(rand).toISOString().slice(11, 19);
      break;
    case 'uuid':
      value = randomUuid(rand);
      break;
    case 'email':
      value = `${frag}@example.com`;
      break;
    case 'uri':
    case 'url':
      value = `https://example.com/${frag}`;
      break;
    case 'hostname':
      value = `${frag}.example.com`;
      break;
    case 'ipv4': {
      const octet = (): number => 1 + Math.floor(rand() * 254);
      value = `${octet()}.${octet()}.${octet()}.${octet()}`;
      break;
    }
    case 'ipv6': {
      const hextet = (): string => Math.floor(rand() * 65536).toString(16);
      value = Array.from({ length: 8 }, hextet).join(':');
      break;
    }
    default:
      // Unknown or absent format: a plain random string.
      value = frag;
      break;
  }
  // Explicit length constraints win over format fidelity.
  const minLength =
    typeof schema.minLength === 'number' && schema.minLength > 0 ? schema.minLength : 0;
  const maxLength =
    typeof schema.maxLength === 'number' && schema.maxLength >= 0 ? schema.maxLength : Infinity;
  if (value.length < minLength) {
    value += 'x'.repeat(minLength - value.length);
  }
  if (value.length > maxLength) {
    value = value.slice(0, maxLength);
  }
  return value;
}

function generateNumber(
  schema: Record<string, unknown>,
  rand: () => number,
  integer: boolean,
): number {
  const minimum = typeof schema.minimum === 'number' ? schema.minimum : 0;
  const maximum =
    typeof schema.maximum === 'number' && schema.maximum > minimum
      ? schema.maximum
      : minimum + 1000;
  const value = minimum + rand() * (maximum - minimum);
  return integer ? Math.floor(value) : value;
}

function generateObject(
  schema: Record<string, unknown>,
  rand: () => number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : [];
  for (const [key, propSchema] of Object.entries(properties)) {
    // Required properties are always present; optional ones are included
    // about half the time for realistic variety.
    if (required.includes(key) || rand() < 0.5) {
      result[key] = generateFromSchema(propSchema, rand);
    }
  }
  return result;
}

function generateArray(schema: Record<string, unknown>, rand: () => number): unknown[] {
  if (!isRecord(schema.items)) {
    return [];
  }
  const count = 1 + Math.floor(rand() * 3);
  return Array.from({ length: count }, () => generateFromSchema(schema.items, rand));
}

/**
 * Generates a mock value from a JSON Schema. Never throws: anything
 * unrecognized (unknown types, `$ref`s, boolean schemas, non-objects)
 * yields `null`.
 *
 * @param schema the JSON Schema to generate from
 * @param rand seeded PRNG driving all random choices
 */
export function generateFromSchema(schema: unknown, rand: () => number): unknown {
  if (!isRecord(schema)) {
    return null;
  }
  // `enum` wins over `type`: any listed value is a faithful mock.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[Math.floor(rand() * schema.enum.length)];
  }
  // anyOf/oneOf: the first variant is a valid mock for the whole schema.
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined;
  if (variants !== undefined && variants.length > 0) {
    return generateFromSchema(variants[0], rand);
  }
  // `type` may be an array (e.g. ["string", "null"]); use the first.
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'object':
      return generateObject(schema, rand);
    case 'array':
      return generateArray(schema, rand);
    case 'string':
      return generateString(schema, rand);
    case 'integer':
      return generateNumber(schema, rand, true);
    case 'number':
      return generateNumber(schema, rand, false);
    case 'boolean':
      return rand() < 0.5;
    case 'null':
      return null;
    default:
      return null;
  }
}
