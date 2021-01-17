import fc, { Arbitrary } from "fast-check";
import {
  RefinementCtx,
  ZodDef,
  ZodOptional,
  ZodSchema,
  ZodTransformer,
  ZodType,
  ZodTypeDef,
  ZodTypes,
} from "zod";
import { ZodArrayDef } from "zod/lib/cjs/types/array";
import { ZodEnumDef } from "zod/lib/cjs/types/enum";
import { ZodLazyDef } from "zod/lib/cjs/types/lazy";
import { ZodLiteralDef } from "zod/lib/cjs/types/literal";
import { ZodMapDef } from "zod/lib/cjs/types/map";
import { ZodNativeEnumDef } from "zod/lib/cjs/types/nativeEnum";
import { ZodNullableDef } from "zod/lib/cjs/types/nullable";
import { ZodObjectDef } from "zod/lib/cjs/types/object";
import { ZodOptionalDef } from "zod/lib/cjs/types/optional";
import { ZodRecordDef } from "zod/lib/cjs/types/record";
import { ZodTupleDef } from "zod/lib/cjs/types/tuple";
import { ZodUnionDef } from "zod/lib/cjs/types/union";
import { util as zodUtils } from "zod/lib/cjs/helpers/util";
import { ZodTransformerDef } from "zod/lib/cjs/types/transformer";

type ZodSchemaToArbitrary = (
  schema: ZodSchema<any, any, any>
) => Arbitrary<unknown>;

type ArbitraryBuilder = {
  [TypeName in ZodTypes]: (
    def: ZodDef & { t: TypeName },
    recurse: ZodSchemaToArbitrary
  ) => Arbitrary<unknown>;
};

export function zodInputArbitrary<Input>(
  zodSchema: ZodSchema<any, ZodTypeDef, Input>
): Arbitrary<Input> {
  const def: ZodDef = zodSchema._def as ZodDef;
  const builder = inputArbitraryBuilder[def.t] as (
    def: ZodDef,
    recurse: ZodSchemaToArbitrary
  ) => Arbitrary<unknown>;

  const arbitrary = builder(def, zodInputArbitrary) as Arbitrary<Input>;
  return filterByRefinements(arbitrary, def);
}

export function zodOutputArbitrary<Output>(
  zodSchema: ZodSchema<Output, ZodTypeDef, any>
): Arbitrary<Output> {
  const def: ZodDef = zodSchema._def as ZodDef;
  const builder = outputArbitraryBuilder[def.t] as (
    def: ZodDef,
    recurse: ZodSchemaToArbitrary
  ) => Arbitrary<unknown>;

  const arbitrary = builder(def, zodInputArbitrary) as Arbitrary<Output>;
  return filterByRefinements(arbitrary, def);
}

const baseArbitraryBuilder: Omit<ArbitraryBuilder, "transformer"> = {
  string() {
    return fc.unicodeString({ maxLength: 512 });
  },
  number() {
    return fc.double({ next: true, noNaN: true });
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
    return fc.array(recurse(def.type), { minLength });
  },
  object(def: ZodObjectDef, recurse: ZodSchemaToArbitrary) {
    const propertyArbitraries = Object.fromEntries(
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
  function() {
    throw Error("Function schemas are not yet supported.");
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
  promise() {
    throw Error("Promise schemas are not yet supported.");
  },
  any() {
    return fc.anything();
  },
  unknown() {
    return fc.anything();
  },
  never() {
    throw Error("Never schemas are not yet supported.");
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
};

const inputArbitraryBuilder: ArbitraryBuilder = {
  ...baseArbitraryBuilder,
  transformer(def: ZodTransformerDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.input);
  },
};

const outputArbitraryBuilder: ArbitraryBuilder = {
  ...baseArbitraryBuilder,
  transformer(def: ZodTransformerDef, recurse: ZodSchemaToArbitrary) {
    return recurse(def.input).map(def.transformer);
  },
};

function filterByRefinements(
  arbitrary: Arbitrary<any>,
  def: ZodDef
): Arbitrary<any> {
  const checks = def.checks;
  if (!checks || checks.length === 0) {
    return arbitrary;
  }

  return arbitrary.filter((value) => {
    let isValid = true;

    const context: RefinementCtx = {
      addIssue: () => {
        isValid = false;
      },
      path: [],
    };

    for (let i = 0; isValid && i < checks.length; i++) {
      checks[i].check(value, context);
    }

    return isValid;
  });
}
