# zod-fast-check

A small library to automatically derive [fast-check](https://github.com/dubzzz/fast-check) [arbitraries](https://github.com/dubzzz/fast-check/blob/master/documentation/Arbitraries.md) from schemas defined using the validation library [Zod](https://github.com/colinhacks/zod). These enables easy and thorough property-based testing.

The tool is designed for Zod 2, which brings many new features over Zod 1, but as of writing is still in beta.

## Usage

Here is a complete example using [Jest](https://jestjs.io/).

```ts
import * as z from "zod";
import * as fc from "fast-check";
import { ZodFastCheck } from "zod-fast-check";

// Define a Zod schema
const User = z.object({
  firstName: z.string(),
  lastName: z.string(),
});

// Define an operation using the data type
function fullName(user: unknown): string {
  const parsedUser = User.parse(user);
  return `${parsedUser.firstName} ${parsedUser.lastName}`;
}

// Create an arbitrary which generates valid inputs for the schema
const userArbitrary = ZodFastCheck().inputArbitrary(User);

// Use the arbitrary in a property-based test
test("User's full name always contains their first and last names", () =>
  fc.assert(
    fc.property(userArbitrary, (user) => {
      const name = fullName(user);
      expect(name).toContain(user.firstName);
      expect(name).toContain(user.lastName);
    })
  ));

```

The main interface is the `ZodFastCheck` class, which has the following methods:

### `inputArbitrary`

### `outputArbitrary`

### `override`

## Supported Zod Schema Features

### Data types

✅ string  
✅ number  
✅ bigint  
✅ boolean  
✅ date  
✅ undefined  
✅ null  
✅ array  
✅ object  
✅ union  
✅ tuple  
✅ record  
✅ map  
✅ function  
✅ literal  
✅ enum  
✅ nativeEnum  
✅ promise  
✅ any  
✅ unknown  
✅ void  
✅ optional  
✅ nullable  
❌ intersection  
❌ lazy  
❌ never  

### Refinements

Refinements are supported, but they are produced by filtering the original arbitrary by the refinement function. This means that for refinements which have a very low probability of matching a random input, fast-check will take a very long, potentially infinite, amount of time to find a valid value. This is most common when using refinements to check that a string matches a particular format.

In cases like this, it is recommended to define an override for the problematic subschema.
