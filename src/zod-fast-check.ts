import fc, { Arbitrary } from "fast-check";
import {
  ZodSchema,
  ZodTypeAny,
  ZodTypeDef,
  ZodArrayDef,
  ZodEnumDef,
  ZodLiteralDef,
  ZodMapDef,
  ZodNativeEnumDef,
  ZodNullableDef,
  ZodObjectDef,
  ZodOptionalDef,
  ZodRecordDef,
  ZodTupleDef,
  ZodUnionDef,
  ZodPromiseDef,
  ZodFunctionDef,
  ZodString,
  ZodNumberDef,
  ZodEffects,
  ZodEffectsDef,
  ZodSetDef,
  ZodDefaultDef,
  ZodStringDef,
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

// TODO add GenericArbitraryBuilder

type ArbitraryBuilder<Schema extends ZodTypeAny = ZodTypeAny> = (
  schema: Schema,
  path: string,
  recurse: ArbitraryBuilder
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

class _ZodFastCheck {
  private overrides = new Map<
    ZodSchema<unknown, ZodTypeDef, unknown>,
    Arbitrary<unknown>
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
    const override = this.overrides.get(schema);

    if (override) {
      return override as Arbitrary<Input>;
    } else {
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

      return findArbitraryBuilder(schema)(
        schema,
        path,
        this.inputWithPath.bind(this)
      );
    }
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

  /**
   * Returns a new `ZodFastCheck` instance which will use the provided
   * arbitrary when generating inputs for the given schema.
   */
  override<Input>(
    schema: ZodSchema<unknown, ZodTypeDef, Input>,
    arbitrary: Arbitrary<Input>
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
  schema: ZodTypeAny
): schema is ZodFirstPartySchemaTypes {
  const typeName = schema._def.typeName as string | undefined;
  return (
    !!typeName &&
    Object.prototype.hasOwnProperty.call(arbitraryBuilders, typeName)
  );
}

function findArbitraryBuilder<Input>(
  zodSchema: ZodSchema<unknown, ZodTypeDef, Input>
): ArbitraryBuilder<typeof zodSchema> {
  if (isFirstPartyType(zodSchema)) {
    return arbitraryBuilders[zodSchema._def.typeName] as ArbitraryBuilder<any>;
  }

  throw Error(`Unsupported schema type: ${zodSchema.constructor.name}.`);
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
    schema: ZodArray<ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    const minLength = schema._def.minLength?.value ?? 0;
    const maxLength = Math.min(schema._def.maxLength?.value ?? 10, 10);
    return fc.array(
      recurse(schema._def.type, path + "[*]", recurse),
      minLength,
      maxLength
    );
  },
  ZodObject(
    schema: ZodObject<ZodRawShape>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    const propertyArbitraries = objectFromEntries(
      Object.entries(schema._def.shape()).map(([property, propSchema]) => [
        property,
        recurse(propSchema, path + "." + property, recurse),
      ])
    );
    return fc.record(propertyArbitraries);
  },
  ZodUnion(
    schema: ZodUnion<[ZodTypeAny, ...ZodTypeAny[]]>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    return fc.oneof(
      ...schema._def.options.map((option) => recurse(option, path, recurse))
    );
  },
  ZodIntersection() {
    throw Error("Intersection schemas are not yet supported.");
  },
  ZodTuple(schema: ZodTuple, path: string, recurse: ArbitraryBuilder) {
    return fc.genericTuple(
      schema._def.items.map((item, index) =>
        recurse(item, `${path}[${index}]`, recurse)
      )
    ) as Arbitrary<[any, ...any[]]>;
  },
  ZodRecord(schema: ZodRecord, path: string, recurse: ArbitraryBuilder) {
    return fc.dictionary(
      fc.string(),
      recurse(schema._def.valueType, path + "[*]", recurse)
    );
  },
  ZodMap(schema: ZodMap, path: string, recurse: ArbitraryBuilder) {
    const key = recurse(schema._def.keyType, path + ".(key)", recurse);
    const value = recurse(schema._def.valueType, path + ".(value)", recurse);
    return fc.array(fc.tuple(key, value)).map((entries) => new Map(entries));
  },
  ZodSet(schema: ZodSet, path: string, recurse: ArbitraryBuilder) {
    return fc
      .set(recurse(schema._def.valueType, path + ".(value)", recurse))
      .map((members) => new Set(members));
  },
  ZodFunction(
    schema: ZodFunction<ZodTuple, ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    return recurse(
      schema._def.returns,
      path + ".(return type)",
      recurse
    ).map((returnValue) => () => returnValue);
  },
  ZodLazy() {
    throw Error("Lazy schemas are not yet supported.");
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
    schema: ZodPromise<ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    return recurse(
      schema._def.type,
      path + ".(resolved type)",
      recurse
    ).map((value) => Promise.resolve(value));
  },
  ZodAny() {
    return fc.anything();
  },
  ZodUnknown() {
    return fc.anything();
  },
  ZodNever() {
    throw Error("A runtime value cannot be generated for a 'never' schema.");
  },
  ZodVoid() {
    return fc.constant(undefined);
  },
  ZodOptional(
    schema: ZodOptional<ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    const nil = undefined;
    return fc.option(recurse(schema._def.innerType, path, recurse), {
      nil,
      freq: 2,
    });
  },
  ZodNullable(
    schema: ZodNullable<ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    const nil = null;
    return fc.option(recurse(schema._def.innerType, path, recurse), {
      nil,
      freq: 2,
    });
  },
  ZodDefault(
    schema: ZodDefault<ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    return fc.oneof(
      fc.constant(undefined),
      recurse(schema._def.innerType, path, recurse)
    );
  },
  ZodEffects(
    schema: ZodEffects<ZodTypeAny>,
    path: string,
    recurse: ArbitraryBuilder
  ) {
    const preEffectsArbitrary = recurse(schema._def.schema, path, recurse);

    return filterArbitraryBySchema(preEffectsArbitrary, schema, path);
  },
};

export class ZodFastCheckError extends Error {}

// TODO ZodFastCheckUnsupportedSchemaError

export class ZodFastCheckGenerationError extends ZodFastCheckError {}

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
  schema: ZodSchema<any, any, T>,
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

export const getValidEnumValues = (obj: any) => {
  const validKeys = Object.keys(obj).filter(
    (k: any) => typeof obj[obj[k]] !== "number"
  );
  const filtered: any = {};
  for (const k of validKeys) {
    filtered[k] = obj[k];
  }
  return getValues(filtered);
};

export const getValues = (obj: any) => {
  return Object.keys(obj).map(function (e) {
    return obj[e];
  });
};
