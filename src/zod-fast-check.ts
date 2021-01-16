import fc, { Arbitrary } from "fast-check";
import { ZodDef, ZodType, ZodTypeDef, ZodTypes } from "zod";

export function zodInputArbitrary<Input>(
  zodType: ZodType<any, ZodTypeDef, Input>
): Arbitrary<Input> {
  const def: ZodDef = zodType._def as ZodDef;
  let arbitrary: unknown;

  switch (def.t) {
    case ZodTypes.string:
      arbitrary = fc.unicodeString();
      break;
    case ZodTypes.number:
      arbitrary = fc.double({ next: true, noNaN: true });
      break;
    case ZodTypes.bigint:
      arbitrary = fc.bigInt();
      break;
    case ZodTypes.boolean:
      arbitrary = fc.boolean();
      break;
    case ZodTypes.date:
      arbitrary = fc.date();
      break;
    case ZodTypes.undefined:
      arbitrary = fc.constant(undefined);
      break;
    case ZodTypes.null:
      arbitrary = fc.constant(null);
      break;
    case ZodTypes.array:
      const minLength = def.nonempty ? 1 : 0;
      arbitrary = fc.array(zodInputArbitrary(def.type), { minLength });
      break;
    case ZodTypes.object:
    case ZodTypes.union:
    case ZodTypes.intersection:
    case ZodTypes.tuple:
    case ZodTypes.record:
    case ZodTypes.map:
    case ZodTypes.function:
    case ZodTypes.lazy:
    case ZodTypes.literal:
    case ZodTypes.enum:
    case ZodTypes.nativeEnum:
    case ZodTypes.promise:
    case ZodTypes.any:
    case ZodTypes.unknown:
    case ZodTypes.never:
    case ZodTypes.void:
    case ZodTypes.transformer:
    case ZodTypes.optional:
    case ZodTypes.nullable:
    default:
      throw Error(
        `The provided Zod schema type is not yet supported (${def.t}).`
      );
  }

  return arbitrary as Arbitrary<Input>;
}

// type DefToType<Def extends ZodDef> = Def extends ZodNullDef ? null : never;
