import fc, { Arbitrary } from "fast-check";
import { ZodDef, ZodOptional, ZodType, ZodTypeDef, ZodTypes } from "zod";
import { ZodArrayDef } from "zod/lib/cjs/types/array";
import { ZodLazyDef } from "zod/lib/cjs/types/lazy";
import { ZodLiteralDef } from "zod/lib/cjs/types/literal";
import { ZodMapDef } from "zod/lib/cjs/types/map";
import { ZodNullableDef } from "zod/lib/cjs/types/nullable";
import { ZodObjectDef } from "zod/lib/cjs/types/object";
import { ZodOptionalDef } from "zod/lib/cjs/types/optional";
import { ZodRecordDef } from "zod/lib/cjs/types/record";
import { ZodTupleDef } from "zod/lib/cjs/types/tuple";
import { ZodUnionDef } from "zod/lib/cjs/types/union";

type ArbitraryBuilder = {
  [TypeName in ZodTypes]: (def: ZodDef & { t: TypeName }) => Arbitrary<unknown>;
};

export function zodInputArbitrary<Input>(
  zodType: ZodType<any, ZodTypeDef, Input>
): Arbitrary<Input> {
  const def: ZodDef = zodType._def as ZodDef;
  const builder = arbitraryBuilder[def.t] as (
    def: ZodDef
  ) => Arbitrary<unknown>;
  return builder(def) as Arbitrary<Input>;
}

const arbitraryBuilder: ArbitraryBuilder = {
  string() {
    return fc.unicodeString();
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
  array(def: ZodArrayDef) {
    const minLength = def.nonempty ? 1 : 0;
    return fc.array(zodInputArbitrary(def.type), { minLength });
  },
  object(def: ZodObjectDef) {
    const propertyArbitraries = Object.fromEntries(
      Object.entries(def.shape()).map(([property, propSchema]) => [
        property,
        zodInputArbitrary(propSchema),
      ])
    );
    return fc.record(propertyArbitraries);
  },
  union(def: ZodUnionDef) {
    return fc.oneof(...def.options.map(zodInputArbitrary));
  },
  intersection() {
    throw Error("Intersection schemas are not yet supported.");
  },
  tuple(def: ZodTupleDef) {
    return fc.genericTuple(def.items.map(zodInputArbitrary));
  },
  record(def: ZodRecordDef) {
    return fc.dictionary(fc.string(), zodInputArbitrary(def.valueType));
  },
  map(def: ZodMapDef) {
    const key = zodInputArbitrary(def.keyType);
    const value = zodInputArbitrary(def.valueType);
    return fc.array(fc.tuple(key, value)).map((entries) => new Map(entries));
  },
  function() {
    throw Error("Function schemas are not yet supported.");
  },
  lazy(def: ZodLazyDef) {
    throw Error("Lazy schemas are not yet supported.");
  },
  literal(def: ZodLiteralDef) {
    return fc.constant(def.value);
  },
  enum() {
    throw Error("Enum schemas are not yet supported.");
  },
  nativeEnum() {
    throw Error("NativeEnum schemas are not yet supported.");
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
  transformer() {
    throw Error("Transformer schemas are not yet supported.");
  },
  optional(def: ZodOptionalDef) {
    const nil = undefined;
    return fc.option(zodInputArbitrary(def.innerType), { nil, freq: 2 });
  },
  nullable(def: ZodNullableDef) {
    const nil = null;
    return fc.option(zodInputArbitrary(def.innerType), { nil, freq: 2 });
  },
};
