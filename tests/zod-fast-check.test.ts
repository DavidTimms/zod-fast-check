import fc from "fast-check";
import * as z from "zod";
import {
  INVALID,
  OK,
  ParseInput,
  ParseReturnType,
  ZodSchema,
  ZodTypeAny,
  ZodTypeDef,
} from "zod";
import {
  ZodFastCheck,
  ZodFastCheckGenerationError,
  ZodFastCheckUnsupportedSchemaError,
} from "../src/zod-fast-check";

describe("Generate arbitraries for Zod schema input types", () => {
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

  const penguinSymbol = Symbol.for("penguin");

  const schemas = {
    string: z.string(),
    number: z.number(),
    bigint: z.bigint(),
    boolean: z.boolean(),
    date: z.date(),
    undefined: z.undefined(),
    null: z.null(),
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
    "discriminated union": z.discriminatedUnion("type", [
      z.object({ type: z.literal("a"), a: z.string() }),
      z.object({
        type: z.literal("b"),
        b: z.object({
          x: z.string(),
        }),
      }),
      z.object({
        type: z.literal("c"),
        c: z.number(),
      }),
    ]),
    nan: z.nan(),
    "string branded with string": z.string().brand<"timezone">(),
    "object branded with number": z.object({ a: z.boolean() }).brand<123>(),
    "array branded with symbol": z
      .array(z.number())
      .brand<typeof penguinSymbol>(),
    "empty tuple": z.tuple([]),
    "nonempty tuple": z.tuple([z.string(), z.boolean(), z.date()]),
    "nested tuple": z.tuple([z.string(), z.tuple([z.number()])]),
    "record of numbers": z.record(z.number()),
    "record of objects": z.record(z.object({ name: z.string() })),
    "record of strings": z.record(z.string()),
    "record of strings with min-length values": z.record(z.string().min(1)),
    "record of strings with min-length keys": z.record(z.string().min(1), z.string()),
    "map with string keys": z.map(z.string(), z.number()),
    "map with object keys": z.map(
      z.object({ id: z.number() }),
      z.array(z.boolean())
    ),
    set: z.set(z.number()),
    "nonempty set": z.set(z.number()).nonempty(),
    "set with min": z.set(z.number()).min(2),
    "set with max": z.set(z.number()).max(3),
    "function returning boolean": z.function().returns(z.boolean()),
    "literal number": z.literal(123.5),
    "literal string": z.literal("hello"),
    "literal boolean": z.literal(false),
    "literal symbol": z.literal(Symbol("mySymbol")),
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
    "number with float max and min": z.number().min(0.5).max(1.5),
    int: z.number().int(),
    positive: z.number().positive(),
    negative: z.number().negative(),
    nonpositive: z.number().nonpositive(),
    nonnegative: z.number().nonnegative(),
    finite: z.number().finite(),
    "multiple of": z.number().multipleOf(3),
    "multiple multiple of": z.number().multipleOf(3).multipleOf(5),
    "multiple of with min and max": z.number().multipleOf(10).min(67).max(99),
    "number with custom refinement": z.number().refine((x) => x % 3 === 0),

    "string with minimum length": z.string().min(24),
    "string with maximum length": z.string().max(24),
    "string with fixed length": z.string().length(256),
    "string with prefix": z.string().startsWith("prefix"),
    "string with suffix": z.string().endsWith("suffix"),
    cuid: z.string().cuid(),
    cuid2: z.string().cuid2(),
    uuid: z.string().uuid(),
    url: z.string().url(),
    email: z.string().email(),
    regex: z.string().regex(/\s/),
    datetime: z.string().datetime(),
    "datetime with offset": z.string().datetime({ offset: true }),
    "datetime with low precision": z.string().datetime({ precision: 0 }),
    "datetime with high precision": z.string().datetime({ precision: 6 }),
    "number to string transformer": z.number().transform(String),
    "deeply nested transformer": z.array(z.boolean().transform(Number)),
    "string to number pipeline": z
      .string()
      .transform((s) => s.length)
      .pipe(z.number().min(5)),
    "Coerced string": z.coerce.string(),
    "Coerced number": z.coerce.number(),
    "Coerced boolean": z.coerce.boolean(),
    "Coerced bigint": z.coerce.bigint(),
    "Coerced date": z.coerce.date(),
    "string with catch": z.string().catch("fallback"),
    symbol: z.symbol(),
    readonly: z.number().readonly(),

    // bigint tests
    "bigint gt": z.bigint().gt(BigInt(5)),
    "bigint gte": z.bigint().gte(BigInt(5)),
    "bigint lt": z.bigint().lt(BigInt(5)),
    "bigint lte": z.bigint().lte(BigInt(5)),
    "bigint positive": z.bigint().positive(),
    "bigint nonnegative": z.bigint().nonnegative(),
    "bigint negative": z.bigint().negative(),
    "bigint nonpositive": z.bigint().nonpositive(),
    // todo - "bigint multipleof": z.bigint().multipleOf(BigInt(5)),
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

describe("Generate arbitraries for Zod schema output types", () => {
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

  test("string with catch", () => {
    const targetSchema = z.string();
    const schema = z.string().catch("fallback");

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        targetSchema.parse(value);
      })
    );
  });

  test("trimmed string", () => {
    const schema = z.string().trim();

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        value.match(/^\s/) === null && value.match(/\s$/) === null;
      })
    );
  });

  test("a branded type schema uses an arbitrary for the underlying schema", () => {
    const schema = z.string().brand<"brand">();
    type BrandedString = z.output<typeof schema>;

    const arbitrary = ZodFastCheck().outputOf(schema);

    return fc.assert(
      fc.property(arbitrary, (value: BrandedString) => {
        expect(typeof value).toBe("string");
      })
    );
  });

  test("string to number pipeline", () => {
    const targetSchema = z.number().min(5).int();
    const schema = z
      .string()
      .transform((s) => s.length)
      .pipe(z.number().min(5));

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

  test("using a function to lazily define an override", () => {
    const NumericString = z.string().regex(/^\d+$/);

    const zfc = ZodFastCheck().override(NumericString, (zfc) =>
      zfc.inputOf(z.number().int().nonnegative()).map(String)
    );

    const arbitrary = zfc.outputOf(NumericString);

    return fc.assert(
      fc.property(arbitrary, (value) => {
        expect(value).toMatch(/^\d+$/);
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
    ).toThrow(
      new ZodFastCheckGenerationError(
        "Unable to generate valid values for Zod schema. " +
          "An override is must be provided for the schema at path '.'."
      )
    );
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

  // Tests for the "paths" given in error messages to locate the problematic
  // sub-schema within a nested schema.

  const impossible = z.string().refine(() => false);

  const cases: {
    description: string;
    schema: ZodTypeAny;
    expectedErrorPath: string;
  }[] = [
    {
      description: "nested objects",
      schema: z.object({ foo: z.object({ bar: impossible }) }),
      expectedErrorPath: ".foo.bar",
    },
    {
      description: "arrays",
      schema: z.object({ items: z.array(impossible) }),
      expectedErrorPath: ".items[*]",
    },
    {
      description: "unions",
      schema: z.object({ status: z.union([z.number(), impossible]) }),
      expectedErrorPath: ".status",
    },
    {
      description: "discriminated unions",
      schema: z.discriminatedUnion("type", [
        z.object({ type: z.literal("a"), a: impossible }),
        z.object({ type: z.literal("b"), b: z.string() }),
      ]),
      expectedErrorPath: ".a",
    },
    {
      description: "tuples",
      schema: z.object({
        scores: z.record(impossible),
      }),
      expectedErrorPath: ".scores[*]",
    },
    {
      description: "map keys",
      schema: z.object({
        scores: z.map(impossible, z.number()),
      }),
      expectedErrorPath: ".scores.(key)",
    },
    {
      description: "map values",
      schema: z.object({
        scores: z.map(z.string(), impossible),
      }),
      expectedErrorPath: ".scores.(value)",
    },
    {
      description: "function return types",
      schema: z.object({
        myFunction: z.function(z.tuple([]), impossible),
      }),
      expectedErrorPath: ".myFunction.(return type)",
    },
    {
      description: "promise resolved types",
      schema: z.object({
        myPromise: z.promise(impossible),
      }),
      expectedErrorPath: ".myPromise.(resolved type)",
    },
    {
      description: "optional types",
      schema: z.object({
        myOptional: z.optional(impossible),
      }),
      expectedErrorPath: ".myOptional",
    },
    {
      description: "nullable types",
      schema: z.object({
        myNullable: z.nullable(impossible),
      }),
      expectedErrorPath: ".myNullable",
    },
    {
      description: "types with defaults",
      schema: z.object({
        withDefault: impossible.default(""),
      }),
      expectedErrorPath: ".withDefault",
    },
    {
      description: "types with transforms",
      schema: z.object({
        withTransform: impossible.transform((s) => !!s),
      }),
      expectedErrorPath: ".withTransform",
    },
  ];

  for (const { description, schema, expectedErrorPath } of cases) {
    test("correct error path is shown for " + description, () => {
      const arbitrary = ZodFastCheck().inputOf(schema);

      expect(() => fc.assert(fc.property(arbitrary, () => true))).toThrow(
        new ZodFastCheckGenerationError(
          "Unable to generate valid values for Zod schema. " +
            `An override is must be provided for the schema at path '${expectedErrorPath}'.`
        )
      );
    });
  }

  test("generating input values for an impossible pipeline", () => {
    const arbitrary = ZodFastCheck().inputOf(z.string().pipe(z.boolean()));

    expect(() =>
      fc.assert(
        fc.property(arbitrary, (value) => {
          return true;
        })
      )
    ).toThrow(
      new ZodFastCheckGenerationError(
        "Unable to generate valid values for Zod schema. " +
          "An override is must be provided for the schema at path '.'."
      )
    );
  });
});

describe("Throwing an error if the schema type is not supported", () => {
  test("lazy schemas", () => {
    expect(() => ZodFastCheck().inputOf(z.lazy(() => z.string()))).toThrow(
      new ZodFastCheckUnsupportedSchemaError(
        "Unable to generate valid values for Zod schema. " +
          "Lazy schemas are not supported (at path '.')."
      )
    );
  });

  test("never schemas", () => {
    expect(() => ZodFastCheck().inputOf(z.never())).toThrow(
      new ZodFastCheckUnsupportedSchemaError(
        "Unable to generate valid values for Zod schema. " +
          "Never schemas are not supported (at path '.')."
      )
    );
  });

  test("intersection schemas", () => {
    expect(() =>
      ZodFastCheck().inputOf(
        z.intersection(
          z.object({ foo: z.string() }),
          z.object({ bar: z.number() })
        )
      )
    ).toThrow(
      new ZodFastCheckUnsupportedSchemaError(
        "Unable to generate valid values for Zod schema. " +
          "Intersection schemas are not supported (at path '.')."
      )
    );
  });

  test("third-party schemas", () => {
    interface ZodSymbolDef extends ZodTypeDef {
      symbol: Symbol;
    }

    class SymbolSchema extends ZodSchema<Symbol, ZodSymbolDef, Symbol> {
      _parse({ data }: ParseInput): ParseReturnType<Symbol> {
        if (data === this._def.symbol) {
          return OK(data);
        }
        return INVALID;
      }
    }

    expect(() =>
      ZodFastCheck().inputOf(new SymbolSchema({ symbol: Symbol.iterator }))
    ).toThrow(
      new ZodFastCheckUnsupportedSchemaError(
        "Unable to generate valid values for Zod schema. " +
          "'SymbolSchema' schemas are not supported (at path '.')."
      )
    );
  });
});
