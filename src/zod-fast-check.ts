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
} from "zod";

const MIN_SUCCESS_RATE = 0.01;

type ZodSchemaToArbitrary = (
  schema: ZodSchema<unknown, ZodTypeDef, unknown>
) => Arbitrary<unknown>;

type ZodFirstPartyTypeKind = ZodFirstPartySchemaTypes["_def"]["typeName"];

type ArbitraryBuilders = {
  [TypeName in ZodFirstPartyTypeKind]: (
    def: ExtractFirstPartySchemaType<TypeName>["_def"],
    recurse: ZodSchemaToArbitrary
  ) => Arbitrary<ExtractFirstPartySchemaType<TypeName>["_input"]>;
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
    zodSchema: ZodSchema<unknown, ZodTypeDef, Input>
  ): Arbitrary<Input> {
    let def = zodSchema._def;

    const override = this.overrides.get(zodSchema);

    if (override) {
      return override as Arbitrary<Input>;
    } else {
      // This is an appalling hack which is required to support
      // the ZodNonEmptyArray type in Zod 3.5 and 3.6. The type was
      // removed in Zod 3.7.
      if (zodSchema.constructor.name === "ZodNonEmptyArray") {
        def = {
          ...def,
          minLength: (def as ZodArrayDef).minLength ?? { value: 1 },
        };
      }

      return findArbitraryBuilder(zodSchema)(def, this.inputOf.bind(this));
    }
  }

  /**
   * Creates an arbitrary which will generate valid parsed outputs of
   * the schema.
   */
  outputOf<Output, Input>(
    zodSchema: ZodSchema<Output, ZodTypeDef, Input>
  ): Arbitrary<Output> {
    let inputArbitrary = this.inputOf(zodSchema);

    // For scalar types, the input is always the same as the output,
    // so we can just use the input arbitrary unchanged.
    if (
      isFirstPartyType(zodSchema) &&
      SCALAR_TYPES.has(`${zodSchema._def.typeName}` as const)
    ) {
      return inputArbitrary as Arbitrary<any>;
    }

    return inputArbitrary
      .map((value) => zodSchema.safeParse(value))
      .filter(
        throwIfSuccessRateBelow(
          MIN_SUCCESS_RATE,
          isUnionMember({ success: true })
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
): (def: ZodTypeDef, recurse: ZodSchemaToArbitrary) => Arbitrary<Input> {
  if (isFirstPartyType(zodSchema)) {
    return arbitraryBuilders[zodSchema._def.typeName] as (
      def: ZodTypeDef,
      recurse: ZodSchemaToArbitrary
    ) => Arbitrary<any>;
  }

  throw Error(`Unsupported schema type: ${zodSchema.constructor.name}.`);
}

const arbitraryBuilders: ArbitraryBuilders = {
  ZodString(def: ZodStringDef) {
    let minLength = 0;
    let maxLength: number | null = null;
    let hasRegexCheck = false;

    for (const check of def.checks) {
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
      return filterArbitraryBySchema(unfiltered, new ZodString(def));
    } else {
      return unfiltered;
    }
  },
  ZodNumber(def: ZodNumberDef) {
    let min = -(2 ** 64);
    let max = 2 ** 64;
    let isInt = false;

    for (const check of def.checks) {
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
  ZodArray(def: ZodArrayDef, recurse: ZodSchemaToArbitrary) {
    const minLength = def.minLength?.value ?? 0;
    const maxLength = Math.min(def.maxLength?.value ?? 10, 10);
    return fc.array(recurse(def.type), minLength, maxLength);
  },
  ZodObject(def: ZodObjectDef, recurse: ZodSchemaToArbitrary) {
    const propertyArbitraries = objectFromEntries(
      Object.entries(def.shape()).map(([property, propSchema]) => [
        property,
        recurse(propSchema),
      ])
    );
    return fc.record(propertyArbitraries);
  },
  ZodUnion(def: ZodUnionDef, recurse: ZodSchemaToArbitrary) {
    return fc.oneof(...def.options.map(recurse));
  },
  ZodIntersection() {
    throw Error("Intersection schemas are not yet supported.");
  },
  ZodTuple(def: ZodTupleDef, recurse: ZodSchemaToArbitrary) {
    return fc.genericTuple(def.items.map(recurse)) as Arbitrary<
      [any, ...any[]]
    >;
  },
  ZodRecord(def: ZodRecordDef, recurse: ZodSchemaToArbitrary) {
    return fc.dictionary(fc.string(), recurse(def.valueType));
  },
  ZodMap(def: ZodMapDef, recurse: ZodSchemaToArbitrary) {
    const key = recurse(def.keyType);
    const value = recurse(def.valueType);
    return fc.array(fc.tuple(key, value)).map((entries) => new Map(entries));
  },
  ZodSet(def: ZodSetDef, recurse: ZodSchemaToArbitrary) {
    return fc.set(recurse(def.valueType)).map((members) => new Set(members));
  },
  ZodFunction(def: ZodFunctionDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.returns).map((returnValue) => () => returnValue);
  },
  ZodLazy() {
    throw Error("Lazy schemas are not yet supported.");
  },
  ZodLiteral(def: ZodLiteralDef) {
    return fc.constant(def.value);
  },
  ZodEnum(def: ZodEnumDef) {
    return fc.oneof(...def.values.map(fc.constant));
  },
  ZodNativeEnum(def: ZodNativeEnumDef) {
    const enumValues = getValidEnumValues(def.values);
    return fc.oneof(...enumValues.map(fc.constant));
  },
  ZodPromise(def: ZodPromiseDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.type).map((value) => Promise.resolve(value));
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
  ZodOptional(def: ZodOptionalDef, recurse: ZodSchemaToArbitrary) {
    const nil = undefined;
    return fc.option(recurse(def.innerType), { nil, freq: 2 });
  },
  ZodNullable(def: ZodNullableDef, recurse: ZodSchemaToArbitrary) {
    const nil = null;
    return fc.option(recurse(def.innerType), { nil, freq: 2 });
  },
  ZodDefault(def: ZodDefaultDef, recurse: ZodSchemaToArbitrary) {
    return fc.oneof(fc.constant(undefined), recurse(def.innerType));
  },
  ZodEffects(def: ZodEffectsDef, recurse: ZodSchemaToArbitrary) {
    const preEffectsArbitrary = recurse(def.schema);

    const effectsSchema = new ZodEffects(def);

    return filterArbitraryBySchema(preEffectsArbitrary, effectsSchema);
  },
};

export class ZodFastCheckError extends Error {}

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
  schema: ZodSchema<any, any, T>
): Arbitrary<T> {
  return arbitrary.filter(
    throwIfSuccessRateBelow(
      MIN_SUCCESS_RATE,
      (value): value is typeof value => schema.safeParse(value).success
    )
  );
}

function throwIfSuccessRateBelow<Value, Refined extends Value>(
  rate: number,
  predicate: (value: Value) => value is Refined
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
          "An override is must be provided."
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
