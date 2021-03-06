import fc, { Arbitrary } from "fast-check";
import { ZodDef, ZodSchema, ZodTypeDef, ZodTypes } from "zod";
import { ZodArrayDef } from "zod/lib/cjs/types/array";
import { ZodEnumDef } from "zod/lib/cjs/types/enum";
import { ZodLiteralDef } from "zod/lib/cjs/types/literal";
import { ZodMapDef } from "zod/lib/cjs/types/map";
import { ZodNativeEnumDef } from "zod/lib/cjs/types/nativeEnum";
import { ZodNullableDef } from "zod/lib/cjs/types/nullable";
import { ZodObjectDef } from "zod/lib/cjs/types/object";
import { ZodOptionalDef } from "zod/lib/cjs/types/optional";
import { ZodRecordDef } from "zod/lib/cjs/types/record";
import { ZodTupleDef } from "zod/lib/cjs/types/tuple";
import { ZodUnionDef } from "zod/lib/cjs/types/union";
import { ZodTransformerDef } from "zod/lib/cjs/types/transformer";
import { ZodPromiseDef } from "zod/lib/cjs/types/promise";
import { ZodFunctionDef } from "zod/lib/cjs/types/function";
import { util as zodUtils } from "zod/lib/cjs/helpers/util";

const MIN_SUCCESS_RATE = 0.01;

type ZodSchemaToArbitrary = (
  schema: ZodSchema<unknown, ZodTypeDef, unknown>
) => Arbitrary<unknown>;

type ArbitraryBuilder = {
  [TypeName in ZodTypes]: (
    def: Extract<ZodDef, { t: TypeName }>,
    recurse: ZodSchemaToArbitrary
  ) => Arbitrary<unknown>;
};

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
    const def: ZodDef = zodSchema._def as ZodDef;

    let preEffectsArbitrary: Arbitrary<Input>;

    const override = this.overrides.get(zodSchema);

    if (override) {
      preEffectsArbitrary = override as Arbitrary<Input>;
    } else {
      const builder = arbitraryBuilder[def.t] as (
        def: ZodDef,
        recurse: ZodSchemaToArbitrary
      ) => Arbitrary<Input>;

      preEffectsArbitrary = builder(def, this.inputOf.bind(this));
    }

    // Applying the effects quite slow, so we can skip that if
    // there are no effects.
    if ((def.effects ?? []).length === 0) {
      return preEffectsArbitrary as Arbitrary<any>;
    }

    return preEffectsArbitrary.filter(
      throwIfSuccessRateBelow(
        MIN_SUCCESS_RATE,
        (value): value is typeof value => zodSchema.safeParse(value).success
      )
    );
  }

  /**
   * Creates an arbitrary which will generate valid parsed outputs of
   * the schema.
   */
  outputOf<Output, Input>(
    zodSchema: ZodSchema<Output, ZodTypeDef, Input>
  ): Arbitrary<Output> {
    const def: ZodDef = zodSchema._def as ZodDef;

    let preEffectsArbitrary: Arbitrary<Input>;

    const override = this.overrides.get(zodSchema);

    if (override) {
      preEffectsArbitrary = override as Arbitrary<Input>;
    } else {
      const builder = arbitraryBuilder[def.t] as (
        def: ZodDef,
        recurse: ZodSchemaToArbitrary
      ) => Arbitrary<Input>;

      preEffectsArbitrary = builder(def, this.outputOf.bind(this));
    }

    // Applying the effects is quite slow, so we can skip that if
    // there are no effects.
    if ((def.effects ?? []).length === 0) {
      return preEffectsArbitrary as Arbitrary<any>;
    }

    return preEffectsArbitrary
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

const arbitraryBuilder: ArbitraryBuilder = {
  string() {
    return fc.string();
  },
  number() {
    const min = -(2 ** 64);
    const max = 2 ** 64;
    return fc.double(min, max);
  },
  bigint() {
    return fc.bigInt();
  },
  boolean() {
    return fc.boolean();
  },
  date() {
    return fc.date();
  },
  undefined() {
    return fc.constant(undefined);
  },
  null() {
    return fc.constant(null);
  },
  array(def: ZodArrayDef, recurse: ZodSchemaToArbitrary) {
    const minLength = def.nonempty ? 1 : 0;
    const maxLength = 2 * minLength + 10;
    return fc.array(recurse(def.type), minLength, maxLength);
  },
  object(def: ZodObjectDef, recurse: ZodSchemaToArbitrary) {
    const propertyArbitraries = objectFromEntries(
      Object.entries(def.shape()).map(([property, propSchema]) => [
        property,
        recurse(propSchema),
      ])
    );
    return fc.record(propertyArbitraries);
  },
  union(def: ZodUnionDef, recurse: ZodSchemaToArbitrary) {
    return fc.oneof(...def.options.map(recurse));
  },
  intersection() {
    throw Error("Intersection schemas are not yet supported.");
  },
  tuple(def: ZodTupleDef, recurse: ZodSchemaToArbitrary) {
    return fc.genericTuple(def.items.map(recurse));
  },
  record(def: ZodRecordDef, recurse: ZodSchemaToArbitrary) {
    return fc.dictionary(fc.string(), recurse(def.valueType));
  },
  map(def: ZodMapDef, recurse: ZodSchemaToArbitrary) {
    const key = recurse(def.keyType);
    const value = recurse(def.valueType);
    return fc.array(fc.tuple(key, value)).map((entries) => new Map(entries));
  },
  function(def: ZodFunctionDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.returns).map((returnValue) => () => returnValue);
  },
  lazy() {
    throw Error("Lazy schemas are not yet supported.");
  },
  literal(def: ZodLiteralDef) {
    return fc.constant(def.value);
  },
  enum(def: ZodEnumDef) {
    return fc.oneof(...def.values.map(fc.constant));
  },
  nativeEnum(def: ZodNativeEnumDef) {
    const enumValues = zodUtils.getValidEnumValues(def.values);
    return fc.oneof(...enumValues.map(fc.constant));
  },
  promise(def: ZodPromiseDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.type).map((value) => Promise.resolve(value));
  },
  any() {
    return fc.anything();
  },
  unknown() {
    return fc.anything();
  },
  never() {
    throw Error("A runtime value cannot be generated for a 'never' schema.");
  },
  void() {
    return fc.constant(undefined);
  },
  optional(def: ZodOptionalDef, recurse: ZodSchemaToArbitrary) {
    const nil = undefined;
    return fc.option(recurse(def.innerType), { nil, freq: 2 });
  },
  nullable(def: ZodNullableDef, recurse: ZodSchemaToArbitrary) {
    const nil = null;
    return fc.option(recurse(def.innerType), { nil, freq: 2 });
  },
  transformer(def: ZodTransformerDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.schema);
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
