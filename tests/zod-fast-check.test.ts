import fc from "fast-check";
import * as z from "zod";
import {
  ZodFastCheck,
  ZodFastCheckGenerationError,
} from "../src/zod-fast-check";

describe("Generate arbitaries for Zod schema input types", () => {
  enum Biscuits {
    Digestive,
    CustardCream,
    RichTea,
  }

  enum Cakes {
    CarrotCake = "CARROT_CAKE",
    ChocolateCake = "CHOCOLATE_CAKE",
    VictoriaSponge = "VICTORIA_SPONGE",
  }

  const schemas = {
    // string: z.string(),
    // number: z.number(),
    // bigint: z.bigint(),
    // boolean: z.boolean(),
    // date: z.date(),
    // undefined: z.undefined(),
    // null: z.null(),
    // "array of numbers": z.array(z.number()),
    // "array of string": z.array(z.string()),
    // "array of arrays of booleans": z.array(z.array(z.boolean())),
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
    set: z.set(z.number()),
    "function returning boolean": z.function().returns(z.boolean()),
    "literal number": z.literal(123.5),
    "literal string": z.literal("hello"),
    "literal boolean": z.literal(false),
    enum: z.enum(["Bear", "Wolf", "Fox"]),
    "native enum with numeric values": z.nativeEnum(Biscuits),
    "native enum with string values": z.nativeEnum(Cakes),
    "const enum": z.nativeEnum({
      Duck: "duck",
      Swan: "swan",
      Goose: 3,
    }),
    promise: z.promise(z.string()),
    any: z.any(),
    unknown: z.unknown(),
    void: z.void(),
    "optional number": z.optional(z.number()),
    "optional boolean": z.optional(z.boolean()),
    "nullable string": z.nullable(z.string()),
    "nullable object": z.nullable(z.object({ age: z.number() })),
    "with default": z.number().default(0),

    // Schemas which rely on refinements
    "number with minimum": z.number().min(500),
    "number with maximum": z.number().max(500),
    int: z.number().int(),
    positive: z.number().positive(),
    negative: z.number().negative(),
    nonpositive: z.number().nonpositive(),
    nonnegative: z.number().nonnegative(),
    "number with custom refinement": z.number().refine((x) => x % 3 === 0),

    "string with minimum length": z.string().min(24),
    "string with maximum length": z.string().max(24),
    uuid: z.string().uuid(),
    url: z.string().url(),
    email: z.string().email(),
    regex: z.string().regex(/\s/),

    "number to string transformer": z.number().transform(String),
    "deeply nested transformer": z.array(z.boolean().transform(Number)),
  };

  for (const [name, schema] of Object.entries(schemas)) {
    test(name, () => {
      const arbitrary = ZodFastCheck().inputOf(schema);
      return fc.assert(
        fc.asyncProperty(arbitrary, async (value) => {
          await schema.parse(value);
        })
      );
    });
  }
});

describe("Generate arbitaries for Zod schema output types", () => {
  test("number to string transformer", () => {
    const targetSchema = z.string().refine((s) => !isNaN(+s));
    const schema = z.number().transform(String);

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        targetSchema.parse(value);
      })
    );
  });

  test("deeply nested transformer", () => {
    const targetSchema = z.array(z.number());
    const schema = z.array(z.boolean().transform(Number));

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.asyncProperty(arbitrary, async (value) => {
        await targetSchema.parse(value);
      })
    );
  });

  test("transformer within a transformer", () => {
    // This schema accepts an array of booleans and converts them
    // to strings with exclamation marks then concatenates them.
    const targetSchema = z.string().regex(/(true\!|false\!)*/);
    const schema = z
      .array(z.boolean().transform((bool) => `${bool}!`))
      .transform((array) => array.join(""));

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.asyncProperty(arbitrary, async (value) => {
        await targetSchema.parse(value);
      })
    );
  });

  test("doubling transformer", () => {
    // Above this, doubling the number makes it too big to represent,
    // so it gets rounded to infinity.
    const MAX = 1e307;
    const MIN = -MAX;

    const targetSchema = z
      .number()
      .int()
      .refine((x) => x % 2 === 0);
    const schema = z
      .number()
      .int()
      .refine((x) => x < MAX && x > MIN)
      .transform((x) => x * 2);

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        targetSchema.parse(value);
      })
    );
  });

  test("schema with default value", () => {
    // Unlike the input arbitrary, the output arbitrary should never
    // produce "undefined" for a schema with a default.
    const targetSchema = z.string();
    const schema = z.string().default("hello");

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        targetSchema.parse(value);
      })
    );
  });
});

describe("Override the arbitrary for a particular schema type", () => {
  const UUID = z.string().uuid();

  test("using custom UUID arbitrary", () => {
    const arbitrary = ZodFastCheck().override(UUID, fc.uuid()).inputOf(UUID);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        UUID.parse(value);
      })
    );
  });

  test("using custom UUID arbitrary in nested schema", () => {
    const schema = z.object({ ids: z.array(UUID) });

    const arbitrary = ZodFastCheck().override(UUID, fc.uuid()).inputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        schema.parse(value);
      })
    );
  });

  const IntAsString = z.number().int().transform(String);

  test("using custom integer arbitrary for IntAsString input", () => {
    const arbitrary = ZodFastCheck()
      .override(IntAsString, fc.integer())
      .inputOf(IntAsString);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        z.number().int().parse(value);
      })
    );
  });

  test("using custom integer arbitrary for IntAsString output", () => {
    const arbitrary = ZodFastCheck()
      .override(IntAsString, fc.integer())
      .outputOf(IntAsString);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        expect(typeof value).toBe("string");
        expect(Number(value) === parseInt(value, 10));
      })
    );
  });
});

describe("Throwing an error if it is not able to generate a value", () => {
  test("generating input values for an impossible refinement", () => {
    const arbitrary = ZodFastCheck().inputOf(z.string().refine(() => false));

    expect(() =>
      fc.assert(
        fc.property(arbitrary, (value) => {
          return true;
        })
      )
    ).toThrow(ZodFastCheckGenerationError);
  });

  test("generating output values for an impossible refinement", () => {
    const arbitrary = ZodFastCheck().outputOf(z.string().refine(() => false));

    expect(() =>
      fc.assert(
        fc.property(arbitrary, (value) => {
          return true;
        })
      )
    ).toThrow(ZodFastCheckGenerationError);
  });
});
