import fc, { Arbitrary } from "fast-check";
import * as z3 from "zod/v3";
import * as z4 from "zod/v4/core";

const MIN_SUCCESS_RATE = 0.01;
const ZOD_EMAIL_REGEX =
  /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

type UnknownZodSchema =
  | z3.ZodSchema<unknown, z3.ZodTypeDef, unknown>
  | z4._$ZodType;

type input<Schema extends UnknownZodSchema> = Schema extends z4._$ZodType
  ? z4.input<Schema>
  : Schema extends z3.ZodType<any, any, any>
  ? z3.input<Schema>
  : never;

type output<Schema extends UnknownZodSchema> = Schema extends z4._$ZodType
  ? z4.output<Schema>
  : Schema extends z3.ZodType<any, any, any>
  ? z3.output<Schema>
  : never;

type SchemaToArbitrary = <Schema extends UnknownZodSchema>(
  schema: Schema,
  path: string
) => Arbitrary<input<Schema>>;

type ArbitraryBuilder<Schema extends UnknownZodSchema> = (
  schema: Schema,
  path: string,
  recurse: SchemaToArbitrary
) => Arbitrary<input<Schema>>;

type Z3ArbitraryBuilders = {
  [TypeName in z3.ZodFirstPartyTypeKind]: ArbitraryBuilder<
    ExtractFirstPartySchemaType<TypeName>
  >;
};

type Z4FirstPartyTypeKind = z4._$ZodTypeInternals["def"]["type"];

type Z4ArbitraryBuilders = {
  [TypeName in Z4FirstPartyTypeKind]: ArbitraryBuilder<
    ExtractFirstPartySchemaType<TypeName>
  >;
};

type ExtractFirstPartySchemaType<
  TypeName extends z3.ZodFirstPartyTypeKind | Z4FirstPartyTypeKind
> =
  | Extract<z3.ZodFirstPartySchemaTypes, { _def: { typeName: TypeName } }>
  | Extract<z4.$ZodTypes, { _zod: { _def: { type: TypeName } } }>;

const Z3_SCALAR_TYPES = new Set<string>([
  "ZodString",
  "ZodNumber",
  "ZodBigInt",
  "ZodBoolean",
  "ZodDate",
  "ZodUndefined",
  "ZodNull",
  "ZodLiteral",
  "ZodEnum",
  "ZodNativeEnum",
  "ZodAny",
  "ZodUnknown",
  "ZodVoid",
]);

type OverrideArbitrary<Input = unknown> =
  | Arbitrary<Input>
  | ((zfc: ZodFastCheck) => Arbitrary<Input>);

class _ZodFastCheck {
  private overrides = new Map<UnknownZodSchema, OverrideArbitrary>();

  private clone(): ZodFastCheck {
    const cloned = new _ZodFastCheck();
    this.overrides.forEach((arbitrary, schema) => {
      cloned.overrides.set(schema, arbitrary);
    });
    return cloned;
  }

  /**
   * Creates an arbitrary which will generate valid inputs to the schema.
   */
  inputOf<Schema extends UnknownZodSchema>(
    schema: Schema
  ): Arbitrary<input<Schema>> {
    return this.inputWithPath(schema, "");
  }

  private inputWithPath<Schema extends UnknownZodSchema>(
    schema: Schema,
    path: string
  ): Arbitrary<input<Schema>> {
    const override = this.findOverride(schema);

    if (override) {
      return override;
    }

    if (!isZod3Schema(schema)) {
      unsupported("Zod 4", path);
    }

    if (isFirstPartyType(schema)) {
      const builder = z3ArbitraryBuilders[
        schema._def.typeName
      ] as ArbitraryBuilder<typeof schema>;

      return builder(schema, path, this.inputWithPath.bind(this));
    }

    unsupported(`'${schema.constructor.name}'`, path);
  }

  /**
   * Creates an arbitrary which will generate valid parsed outputs of
   * the schema.
   */
  outputOf<Schema extends UnknownZodSchema>(
    schema: Schema
  ): Arbitrary<output<Schema>> {
    let inputArbitrary = this.inputOf(schema);

    if (!isZod3Schema(schema)) {
      unsupported("Zod 4", "");
    }

    // For scalar types, the input is always the same as the output,
    // so we can just use the input arbitrary unchanged.
    if (
      isFirstPartyType(schema) &&
      Z3_SCALAR_TYPES.has(`${schema._def.typeName}`)
    ) {
      return inputArbitrary as Arbitrary<any>;
    }

    return inputArbitrary
      .map((value) => schema.safeParse(value))
      .filter(
        throwIfSuccessRateBelow(
          MIN_SUCCESS_RATE,
          isUnionMember({ success: true }),
          ""
        )
      )
      .map((parsed) => parsed.data);
  }

  private findOverride<Schema extends UnknownZodSchema>(
    schema: Schema
  ): Arbitrary<input<Schema>> | null {
    const override = this.overrides.get(schema);

    if (override) {
      return (
        typeof override === "function" ? override(this) : override
      ) as Arbitrary<input<Schema>>;
    }

    return null;
  }

  /**
   * Returns a new `ZodFastCheck` instance which will use the provided
   * arbitrary when generating inputs for the given schema.
   */
  override<Schema extends UnknownZodSchema>(
    schema: Schema,
    arbitrary: OverrideArbitrary<input<Schema>>
  ): ZodFastCheck {
    const withOverride = this.clone();
    withOverride.overrides.set(schema, arbitrary);
    return withOverride;
  }
}

export type ZodFastCheck = _ZodFastCheck;

// Wrapper function to allow instantiation without "new"
export function ZodFastCheck(): ZodFastCheck {
  return new _ZodFastCheck();
}

// Reassign the wrapper function's prototype to ensure
// "instanceof" works as expected.
ZodFastCheck.prototype = _ZodFastCheck.prototype;

function isZod3Schema(schema: UnknownZodSchema): schema is z3.ZodSchema {
  return !("_zod" in schema);
}

function isFirstPartyType(
  schema: z3.ZodSchema
): schema is z3.ZodFirstPartySchemaTypes {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return (
    !!typeName &&
    Object.prototype.hasOwnProperty.call(z3ArbitraryBuilders, typeName)
  );
}

const z3ArbitraryBuilders: Z3ArbitraryBuilders = {
  ZodString(schema: z3.ZodString, path: string) {
    let minLength = 0;
    let maxLength: number | null = null;
    let hasUnsupportedCheck = false;
    const mappings: Array<(s: string) => string> = [];

    for (const check of schema._def.checks) {
      switch (check.kind) {
        case "min":
          minLength = Math.max(minLength, check.value);
          break;
        case "max":
          maxLength = Math.min(maxLength ?? Infinity, check.value);
          break;
        case "length":
          minLength = check.value;
          maxLength = check.value;
          break;
        case "startsWith":
          mappings.push((s) => check.value + s);
          break;
        case "endsWith":
          mappings.push((s) => s + check.value);
          break;
        case "trim":
          // No special handling needed for inputs.
          break;
        case "cuid":
          return createCuidArb();
        case "uuid":
          return fc.uuid();
        case "email":
          return fc
            .emailAddress()
            .filter((email) => ZOD_EMAIL_REGEX.test(email));
        case "url":
          return fc.webUrl();
        case "datetime":
          return createDatetimeStringArb(schema, check);
        default:
          hasUnsupportedCheck = true;
      }
    }

    if (maxLength === null) maxLength = 2 * minLength + 10;

    let unfiltered = fc.string({
      minLength,
      maxLength,
    });

    for (let mapping of mappings) {
      unfiltered = unfiltered.map(mapping);
    }

    if (hasUnsupportedCheck) {
      return filterArbitraryBySchema(unfiltered, schema, path);
    } else {
      return unfiltered;
    }
  },
  ZodNumber(schema: z3.ZodNumber) {
    let min = Number.MIN_SAFE_INTEGER;
    let max = Number.MAX_SAFE_INTEGER;
    let isFinite = false;
    let multipleOf: number | null = null;

    for (const check of schema._def.checks) {
      switch (check.kind) {
        case "min":
          min = Math.max(
            min,
            check.inclusive ? check.value : check.value + 0.001
          );
          break;
        case "max":
          isFinite = true;
          max = Math.min(
            max,
            check.inclusive ? check.value : check.value - 0.001
          );
          break;
        case "int":
          multipleOf ??= 1;
          break;
        case "finite":
          isFinite = true;
          break;
        case "multipleOf":
          multipleOf = (multipleOf ?? 1) * check.value;
          break;
      }
    }

    if (multipleOf !== null) {
      const factor = multipleOf;
      return fc
        .integer({
          min: Math.ceil(min / factor),
          max: Math.floor(max / factor),
        })
        .map((x) => x * factor);
    } else {
      const finiteArb = fc.double({
        min,
        max,
        // fast-check 3 considers NaN to be a Number by default,
        // but Zod does not consider NaN to be a Number
        // see https://github.com/dubzzz/fast-check/blob/main/packages/fast-check/MIGRATION_2.X_TO_3.X.md#new-floating-point-arbitraries-
        noNaN: true,
      });

      if (isFinite) {
        return finiteArb;
      } else {
        return fc.oneof(finiteArb, fc.constant(Infinity));
      }
    }
  },
  ZodBigInt() {
    return fc.bigInt();
  },
  ZodBoolean() {
    return fc.boolean();
  },
  ZodDate() {
    return fc.date();
  },
  ZodUndefined() {
    return fc.constant(undefined);
  },
  ZodNull() {
    return fc.constant(null);
  },
  ZodArray(
    schema: z3.ZodArray<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const minLength = schema._def.minLength?.value ?? 0;
    const maxLength = Math.min(schema._def.maxLength?.value ?? 10, 10);
    return fc.array(recurse(schema._def.type, path + "[*]"), {
      minLength,
      maxLength,
    });
  },
  ZodObject(
    schema: z3.ZodObject<z3.ZodRawShape>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const propertyArbitraries = objectFromEntries(
      Object.entries(schema._def.shape()).map(([property, propSchema]) => [
        property,
        recurse(propSchema, path + "." + property),
      ])
    );
    return fc.record(propertyArbitraries);
  },
  ZodUnion(
    schema: z3.ZodUnion<[z3.ZodTypeAny, ...z3.ZodTypeAny[]]>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return fc.oneof(
      ...schema._def.options.map((option) => recurse(option, path))
    );
  },
  ZodIntersection(_, path: string) {
    unsupported(`Intersection`, path);
  },
  ZodTuple(schema: z3.ZodTuple, path: string, recurse: SchemaToArbitrary) {
    return fc.tuple(
      ...schema._def.items.map((item, index) =>
        recurse(item, `${path}[${index}]`)
      )
    );
  },
  ZodRecord(schema: z3.ZodRecord, path: string, recurse: SchemaToArbitrary) {
    return fc.dictionary(
      recurse(schema._def.keyType, path),
      recurse(schema._def.valueType, path + "[*]")
    );
  },
  ZodMap(schema: z3.ZodMap, path: string, recurse: SchemaToArbitrary) {
    const key = recurse(schema._def.keyType, path + ".(key)");
    const value = recurse(schema._def.valueType, path + ".(value)");
    return fc.array(fc.tuple(key, value)).map((entries) => new Map(entries));
  },
  ZodSet(schema: z3.ZodSet, path: string, recurse: SchemaToArbitrary) {
    const minLength = schema._def.minSize?.value ?? 0;
    const maxLength = Math.min(schema._def.maxSize?.value ?? 10, 10);

    return fc
      .uniqueArray(recurse(schema._def.valueType, path + ".(value)"), {
        minLength,
        maxLength,
      })
      .map((members) => new Set(members));
  },
  ZodFunction(
    schema: z3.ZodFunction<z3.ZodTuple, z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return recurse(schema._def.returns, path + ".(return type)").map(
      (returnValue) => () => returnValue
    );
  },
  ZodLazy(_: unknown, path: string) {
    unsupported(`Lazy`, path);
  },
  ZodLiteral(schema: z3.ZodLiteral<unknown>) {
    return fc.constant(schema._def.value);
  },
  ZodEnum(schema: z3.ZodEnum<[string, ...string[]]>) {
    return fc.oneof(...schema._def.values.map(fc.constant));
  },
  ZodNativeEnum(schema: z3.ZodNativeEnum<any>) {
    const enumValues = getValidEnumValues(schema._def.values);
    return fc.oneof(...enumValues.map(fc.constant));
  },
  ZodPromise(
    schema: z3.ZodPromise<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return recurse(schema._def.type, path + ".(resolved type)").map((value) =>
      Promise.resolve(value)
    );
  },
  ZodAny() {
    return fc.anything();
  },
  ZodUnknown() {
    return fc.anything();
  },
  ZodNever(_: unknown, path: string) {
    unsupported(`Never`, path);
  },
  ZodVoid() {
    return fc.constant(undefined);
  },
  ZodOptional(
    schema: z3.ZodOptional<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const nil = undefined;
    return fc.option(recurse(schema._def.innerType, path), {
      nil,
      freq: 2,
    });
  },
  ZodNullable(
    schema: z3.ZodNullable<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const nil = null;
    return fc.option(recurse(schema._def.innerType, path), {
      nil,
      freq: 2,
    });
  },
  ZodDefault(
    schema: z3.ZodDefault<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return fc.oneof(
      fc.constant(undefined),
      recurse(schema._def.innerType, path)
    );
  },
  ZodEffects(
    schema: z3.ZodEffects<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const preEffectsArbitrary = recurse(schema._def.schema, path);

    return filterArbitraryBySchema(preEffectsArbitrary, schema, path);
  },
  ZodDiscriminatedUnion(
    schema: z3.ZodDiscriminatedUnion<
      string,
      z3.ZodDiscriminatedUnionOption<string>[]
    >,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    // In Zod 3.18 & 3.19, the property is called "options". In later
    // versions it was renamed "optionsMap". Here we use a fallback to
    // support whichever version of Zod the user has installed.
    const optionsMap = schema._def.optionsMap ?? schema._def.options;

    const keys = [...optionsMap.keys()].sort();

    return fc.oneof(
      ...keys.map((discriminator) => {
        const option = optionsMap.get(discriminator);
        if (option === undefined) {
          throw new Error(
            `${String(
              discriminator
            )} should correspond to a variant discriminator, but it does not`
          );
        }
        return recurse(option, path);
      })
    );
  },
  ZodNaN() {
    // This should really be doing some thing like
    // Arbitrary IEEE754 NaN -> DataView -> Number (NaN)
    return fc.constant(Number.NaN);
  },
  ZodBranded(
    schema: z3.ZodBranded<z3.ZodTypeAny, string | number | symbol>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return recurse(schema.unwrap(), path);
  },
  ZodCatch(
    schema: z3.ZodCatch<z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return fc.oneof(recurse(schema._def.innerType, path), fc.anything());
  },
  ZodPipeline(
    schema: z3.ZodPipeline<z3.ZodTypeAny, z3.ZodTypeAny>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return recurse(schema._def.in, path).filter(
      throwIfSuccessRateBelow(
        MIN_SUCCESS_RATE,
        (value): value is typeof value => schema.safeParse(value).success,
        path
      )
    );
  },
  ZodSymbol() {
    return fc.string().map((s) => Symbol(s));
  },
  ZodReadonly(_, path) {
    unsupported("Readonly", path);
  },
};

export class ZodFastCheckError extends Error {}

export class ZodFastCheckUnsupportedSchemaError extends ZodFastCheckError {}

export class ZodFastCheckGenerationError extends ZodFastCheckError {}

function unsupported(schemaTypeName: string, path: string): never {
  throw new ZodFastCheckUnsupportedSchemaError(
    `Unable to generate valid values for Zod schema. ` +
      `${schemaTypeName} schemas are not supported (at path '${path || "."}').`
  );
}

// based on the rough spec provided here: https://github.com/paralleldrive/cuid
function createCuidArb(): Arbitrary<string> {
  return fc
    .tuple(
      fc.hexaString({ minLength: 8, maxLength: 8 }),
      fc
        .integer({ min: 0, max: 9999 })
        .map((n) => n.toString().padStart(4, "0")),
      fc.hexaString({ minLength: 4, maxLength: 4 }),
      fc.hexaString({ minLength: 8, maxLength: 8 })
    )
    .map(
      ([timestamp, counter, fingerprint, random]) =>
        "c" + timestamp + counter + fingerprint + random
    );
}

function createDatetimeStringArb(
  schema: z3.ZodString,
  check: { precision: number | null; offset: boolean }
): Arbitrary<string> {
  let arb = fc
    .date({
      min: new Date("0000-01-01T00:00:00Z"),
      max: new Date("9999-12-31T23:59:59Z"),
    })
    .map((date) => date.toISOString());

  if (check.precision === 0) {
    arb = arb.map((utcIsoDatetime) => utcIsoDatetime.replace(/\.\d+Z$/, `Z`));
  } else if (check.precision !== null) {
    const precision = check.precision;
    arb = arb.chain((utcIsoDatetime) =>
      fc
        .integer({ min: 0, max: Math.pow(10, precision) - 1 })
        .map((x) => x.toString().padStart(precision, "0"))
        .map((fractionalDigits) =>
          utcIsoDatetime.replace(/\.\d+Z$/, `.${fractionalDigits}Z`)
        )
    );
  }

  if (check.offset) {
    // Add an arbitrary timezone offset on, if the schema supports it.
    // UTC−12:00 is the furthest behind UTC, UTC+14:00 is the furthest ahead.
    // This does not generate offsets for half-hour and 15 minute timezones.
    arb = arb.chain((utcIsoDatetime) =>
      fc.integer({ min: -12, max: +14 }).map((offsetHours) => {
        if (offsetHours === 0) {
          return utcIsoDatetime;
        } else {
          const sign = offsetHours > 0 ? "+" : "-";
          const paddedHours = Math.abs(offsetHours).toString().padStart(2, "0");
          return utcIsoDatetime.replace(/Z$/, `${sign}${paddedHours}:00`);
        }
      })
    );
  }

  return arb;
}

/**
 * Returns a type guard which filters one member from a union type.
 */
const isUnionMember =
  <T, Filter extends Partial<T>>(filter: Filter) =>
  (value: T): value is Extract<T, Filter> => {
    return Object.entries(filter).every(
      ([key, expected]) => value[key as keyof T] === expected
    );
  };

function filterArbitraryBySchema<T>(
  arbitrary: Arbitrary<T>,
  schema: z3.ZodSchema<unknown, z3.ZodTypeDef, T>,
  path: string
): Arbitrary<T> {
  return arbitrary.filter(
    throwIfSuccessRateBelow(
      MIN_SUCCESS_RATE,
      (value): value is typeof value => schema.safeParse(value).success,
      path
    )
  );
}

function throwIfSuccessRateBelow<Value, Refined extends Value>(
  rate: number,
  predicate: (value: Value) => value is Refined,
  path: string
): (value: Value) => value is Refined {
  const MIN_RUNS = 1000;

  let successful = 0;
  let total = 0;

  return (value: Value): value is Refined => {
    const isSuccess = predicate(value);

    total += 1;
    if (isSuccess) successful += 1;

    if (total > MIN_RUNS && successful / total < rate) {
      throw new ZodFastCheckGenerationError(
        "Unable to generate valid values for Zod schema. " +
          `An override is must be provided for the schema at path '${
            path || "."
          }'.`
      );
    }

    return isSuccess;
  };
}

function objectFromEntries<Value>(
  entries: Array<[string, Value]>
): Record<string, Value> {
  const object: Record<string, Value> = {};
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    object[key] = value;
  }
  return object;
}

const getValidEnumValues = (
  obj: Record<string | number, string | number>
): unknown[] => {
  const validKeys = Object.keys(obj).filter(
    (key) => typeof obj[obj[key]] !== "number"
  );
  const filtered: Record<string, string | number> = {};
  for (const key of validKeys) {
    filtered[key] = obj[key];
  }
  return Object.values(filtered);
};
