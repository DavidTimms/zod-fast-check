import fc, { Arbitrary } from "fast-check";
import {
  ZodSchema,
  ZodTypeDef,
  ZodArrayDef,
  ZodString,
  ZodEffects,
  ZodFirstPartySchemaTypes,
  ZodNumber,
  ZodArray,
  ZodObject,
  ZodRawShape,
  ZodUnion,
  ZodTuple,
  ZodRecord,
  ZodMap,
  ZodSet,
  ZodFunction,
  ZodLiteral,
  ZodEnum,
  ZodNativeEnum,
  ZodPromise,
  ZodOptional,
  ZodNullable,
  ZodDefault,
} from "zod";

const MIN_SUCCESS_RATE = 0.01;

type UnknownZodSchema = ZodSchema<unknown, ZodTypeDef, unknown>;

type SchemaToArbitrary = <Schema extends UnknownZodSchema>(
  schema: Schema,
  path: string
) => Arbitrary<Schema["_input"]>;

type ArbitraryBuilder<Schema extends UnknownZodSchema> = (
  schema: Schema,
  path: string,
  recurse: SchemaToArbitrary
) => Arbitrary<Schema["_input"]>;

type ZodFirstPartyTypeKind = ZodFirstPartySchemaTypes["_def"]["typeName"];

type ArbitraryBuilders = {
  [TypeName in ZodFirstPartyTypeKind]: ArbitraryBuilder<
    ExtractFirstPartySchemaType<TypeName>
  >;
};

type ExtractFirstPartySchemaType<
  TypeName extends ZodFirstPartyTypeKind
> = Extract<ZodFirstPartySchemaTypes, { _def: { typeName: TypeName } }>;

const SCALAR_TYPES = new Set<`${ZodFirstPartyTypeKind}`>([
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
  | Arbitrary<unknown>
  | ((zfc: ZodFastCheck) => Arbitrary<unknown>);

class _ZodFastCheck {
  private overrides = new Map<
    ZodSchema<unknown, ZodTypeDef, unknown>,
    OverrideArbitrary
  >();

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
  inputOf<Input>(
    schema: ZodSchema<unknown, ZodTypeDef, Input>
  ): Arbitrary<Input> {
    return this.inputWithPath(schema, "");
  }

  private inputWithPath<Input>(
    schema: ZodSchema<unknown, ZodTypeDef, Input>,
    path: string
  ): Arbitrary<Input> {
    const override = this.findOverride(schema);

    if (override) {
      return override;
    }

    // This is an appalling hack which is required to support
    // the ZodNonEmptyArray type in Zod 3.5 and 3.6. The type was
    // removed in Zod 3.7.
    if (schema.constructor.name === "ZodNonEmptyArray") {
      const def = schema._def as ZodArrayDef;
      schema = new ZodArray({
        ...def,
        minLength: def.minLength ?? { value: 1 },
      }) as any;
    }

    if (isFirstPartyType(schema)) {
      const builder = arbitraryBuilders[
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
  outputOf<Output, Input>(
    schema: ZodSchema<Output, ZodTypeDef, Input>
  ): Arbitrary<Output> {
    let inputArbitrary = this.inputOf(schema);

    // For scalar types, the input is always the same as the output,
    // so we can just use the input arbitrary unchanged.
    if (
      isFirstPartyType(schema) &&
      SCALAR_TYPES.has(`${schema._def.typeName}` as const)
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

  private findOverride<Input>(
    schema: ZodSchema<unknown, ZodTypeDef, Input>
  ): Arbitrary<Input> | null {
    const override = this.overrides.get(schema);

    if (override) {
      return (typeof override === "function"
        ? override(this)
        : override) as Arbitrary<Input>;
    }

    return null;
  }

  /**
   * Returns a new `ZodFastCheck` instance which will use the provided
   * arbitrary when generating inputs for the given schema.
   */
  override<Input>(
    schema: ZodSchema<unknown, ZodTypeDef, Input>,
    arbitrary: OverrideArbitrary
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

function isFirstPartyType(
  schema: UnknownZodSchema
): schema is ZodFirstPartySchemaTypes {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return (
    !!typeName &&
    Object.prototype.hasOwnProperty.call(arbitraryBuilders, typeName)
  );
}

const arbitraryBuilders: ArbitraryBuilders = {
  ZodString(schema: ZodString, path: string) {
    let minLength = 0;
    let maxLength: number | null = null;
    let hasRegexCheck = false;

    for (const check of schema._def.checks) {
      switch (check.kind) {
        case "min":
          minLength = Math.max(minLength, check.value);
          break;
        case "max":
          maxLength = Math.min(maxLength ?? Infinity, check.value);
          break;
        case "uuid":
          return fc.uuid();
        case "email":
          return fc.emailAddress();
        case "url":
          return fc.webUrl();
        case "regex":
          hasRegexCheck = true;
          break;
      }
    }

    if (maxLength === null) maxLength = 2 * minLength + 10;

    const unfiltered = fc.string(minLength, maxLength);

    if (hasRegexCheck) {
      return filterArbitraryBySchema(unfiltered, schema, path);
    } else {
      return unfiltered;
    }
  },
  ZodNumber(schema: ZodNumber) {
    let min = -(2 ** 64);
    let max = 2 ** 64;
    let isInt = false;

    for (const check of schema._def.checks) {
      switch (check.kind) {
        case "min":
          min = Math.max(
            min,
            check.inclusive ? check.value : check.value + 0.001
          );
          break;
        case "max":
          max = Math.min(
            max,
            check.inclusive ? check.value : check.value - 0.001
          );
        case "int":
          isInt = true;
      }
    }

    if (isInt) {
      return fc.integer(min, max);
    } else {
      return fc.double(min, max);
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
    schema: ZodArray<UnknownZodSchema>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const minLength = schema._def.minLength?.value ?? 0;
    const maxLength = Math.min(schema._def.maxLength?.value ?? 10, 10);
    return fc.array(
      recurse(schema._def.type, path + "[*]"),
      minLength,
      maxLength
    );
  },
  ZodObject(
    schema: ZodObject<ZodRawShape>,
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
    schema: ZodUnion<[UnknownZodSchema, ...UnknownZodSchema[]]>,
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
  ZodTuple(schema: ZodTuple, path: string, recurse: SchemaToArbitrary) {
    return fc.genericTuple(
      schema._def.items.map((item, index) => recurse(item, `${path}[${index}]`))
    ) as Arbitrary<[any, ...any[]]>;
  },
  ZodRecord(schema: ZodRecord, path: string, recurse: SchemaToArbitrary) {
    return fc.dictionary(
      fc.string(),
      recurse(schema._def.valueType, path + "[*]")
    );
  },
  ZodMap(schema: ZodMap, path: string, recurse: SchemaToArbitrary) {
    const key = recurse(schema._def.keyType, path + ".(key)");
    const value = recurse(schema._def.valueType, path + ".(value)");
    return fc.array(fc.tuple(key, value)).map((entries) => new Map(entries));
  },
  ZodSet(schema: ZodSet, path: string, recurse: SchemaToArbitrary) {
    return fc
      .set(recurse(schema._def.valueType, path + ".(value)"))
      .map((members) => new Set(members));
  },
  ZodFunction(
    schema: ZodFunction<ZodTuple, UnknownZodSchema>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return recurse(
      schema._def.returns,
      path + ".(return type)"
    ).map((returnValue) => () => returnValue);
  },
  ZodLazy(_, path: string) {
    unsupported(`Lazy`, path);
  },
  ZodLiteral(schema: ZodLiteral<unknown>) {
    return fc.constant(schema._def.value);
  },
  ZodEnum(schema: ZodEnum<[string, ...string[]]>) {
    return fc.oneof(...schema._def.values.map(fc.constant));
  },
  ZodNativeEnum(schema: ZodNativeEnum<any>) {
    const enumValues = getValidEnumValues(schema._def.values);
    return fc.oneof(...enumValues.map(fc.constant));
  },
  ZodPromise(
    schema: ZodPromise<UnknownZodSchema>,
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
  ZodNever(_, path: string) {
    unsupported(`Never`, path);
  },
  ZodVoid() {
    return fc.constant(undefined);
  },
  ZodOptional(
    schema: ZodOptional<UnknownZodSchema>,
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
    schema: ZodNullable<UnknownZodSchema>,
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
    schema: ZodDefault<UnknownZodSchema>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    return fc.oneof(
      fc.constant(undefined),
      recurse(schema._def.innerType, path)
    );
  },
  ZodEffects(
    schema: ZodEffects<UnknownZodSchema>,
    path: string,
    recurse: SchemaToArbitrary
  ) {
    const preEffectsArbitrary = recurse(schema._def.schema, path);

    return filterArbitraryBySchema(preEffectsArbitrary, schema, path);
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

/**
 * Returns a type guard which filters one member from a union type.
 */
const isUnionMember = <T, Filter extends Partial<T>>(filter: Filter) => (
  value: T
): value is Extract<T, Filter> => {
  return Object.entries(filter).every(
    ([key, expected]) => value[key as keyof T] === expected
  );
};

function filterArbitraryBySchema<T>(
  arbitrary: Arbitrary<T>,
  schema: ZodSchema<unknown, ZodTypeDef, T>,
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
