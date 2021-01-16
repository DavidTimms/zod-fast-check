import fc, { Arbitrary } from "fast-check";
import { ZodDef, ZodType, ZodTypeDef, ZodTypes } from "zod";
import { ZodArrayDef } from "zod/lib/cjs/types/array";
import { ZodObjectDef } from "zod/lib/cjs/types/object";
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
    if (def.items.length > 0) {
      const [first, ...rest] = def.items.map(zodInputArbitrary);
      return (fc.tuple as (
        ...arbs: Array<Arbitrary<unknown>>
      ) => Arbitrary<unknown>)(first, ...rest);
    } else {
      return fc.constant([]);
    }
  },
  record() {
    throw Error("Record schemas are not yet supported.");
  },
  map() {
    throw Error("Map schemas are not yet supported.");
  },
  function() {
    throw Error("Function schemas are not yet supported.");
  },
  lazy() {
    throw Error("Lazy schemas are not yet supported.");
  },
  literal() {
    throw Error("Literal schemas are not yet supported.");
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
    throw Error("Any schemas are not yet supported.");
  },
  unknown() {
    throw Error("Unknown schemas are not yet supported.");
  },
  never() {
    throw Error("Never schemas are not yet supported.");
  },
  void() {
    throw Error("Void schemas are not yet supported.");
  },
  transformer() {
    throw Error("Transformer schemas are not yet supported.");
  },
  optional() {
    throw Error("Optional schemas are not yet supported.");
  },
  nullable() {
    throw Error("Nullable schemas are not yet supported.");
  },
};
