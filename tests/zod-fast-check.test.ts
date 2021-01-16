import fc from "fast-check";
import * as z from "zod";
import { zodInputArbitrary } from "../src/zod-fast-check";

describe("Generate arbitaries for Zod schema input type", () => {
  const schemas = {
    null: z.null(),
    undefined: z.undefined(),
    string: z.string(),
    number: z.number(),
    bigint: z.bigint(),
    boolean: z.boolean(),
    date: z.date(),
    "array of numbers": z.array(z.number()),
    "array of string": z.array(z.string()),
    "array of arrays of booleans": z.array(z.array(z.boolean())),
    "nonempty array": z.array(z.number()).nonempty(),
    "empty object": z.object({}),
    "simple object": z.object({
      aString: z.string(),
      aBoolean: z.boolean(),
    }),
    "nested object": z.object({
      child: z.object({
        grandchild1: z.null(),
        grandchild2: z.boolean(),
      }),
    }),
    union: z.union([z.boolean(), z.string()]),
    "empty tuple": z.tuple([]),
    "nonempty tuple": z.tuple([z.string(), z.boolean(), z.date()]),
    "nested tuple": z.tuple([z.string(), z.tuple([z.number()])]),
    "record of numbers": z.record(z.number()),
    "record of objects": z.record(z.object({ name: z.string() })),
    "map with string keys": z.map(z.string(), z.number()),
    "map with object keys": z.map(
      z.object({ id: z.number() }),
      z.array(z.boolean())
    ),
    "literal number": z.literal(123.5),
    "literal string": z.literal("hello"),
    "literal boolean": z.literal(false),

    any: z.any(),
    unknown: z.unknown(),
    void: z.void(),
    "optional number": z.optional(z.number()),
    "optional boolean": z.optional(z.boolean()),
    "nullable string": z.nullable(z.string()),
    "nullable object": z.nullable(z.object({ age: z.number() })),
  };

  for (const [name, schema] of Object.entries(schemas)) {
    test(name, () => {
      const arbitrary = zodInputArbitrary<z.infer<typeof schema>>(schema);
      return fc.assert(
        fc.property(arbitrary, (value) => {
          schema.parse(value);
        })
      );
    });
  }
});
