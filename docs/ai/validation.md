# Project Validation

This is a Node TypeScript MCP server that uses https://github.com/modelcontextprotocol/typescript-sdk to serve tool calls.
Whenever terminal output isn't showing, write output to a file in the scratch directory

This document provides instructions for AI agents to validate the project builds correctly and all tests pass.
After writing some implementation you should select the most relevant checks given the changes made. At no point
should we be writing any JavaScript.

```bash
pnpm dev

# Compile main source code
pnpm build
    
# Run the dev server as a foreground process
pnpm dev

# Run lint with automatic fixes - do this first before attempting to fix lint errors via editing  
pnpm lint

# Run all tests
pnpm test

# Run specific tests
pnpm test -- --grep "Name of the test suite or test case"
```

## Project Structure

This project uses the structured approach where tools are automatically discovered from the `src/tools` directory. Each tool is defined in its own file with the following structure:

```typescript
import { z } from "zod";
import { type InferSchema } from "xmcp";

// Define the schema for tool parameters
export const schema = {
  a: z.number().describe("First number to add"),
  b: z.number().describe("Second number to add"),
};

// Define tool metadata
export const metadata = {
  name: "add",
  description: "Add two numbers together",
  annotations: {
    title: "Add Two Numbers",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
};

// Tool implementation
export default async function add({ a, b }: InferSchema<typeof schema>) {
  return {
    content: [{ type: "text", text: String(a + b) }],
  };
}
```

## Adding New Tools

To add a new tool:

1. Create a new `.ts` file in the `src/tools` directory
2. Export a `schema` object defining the tool parameters using Zod
3. Export a `metadata` object with tool information
4. Export a default function that implements the tool logic

## Running the Server

You can run the server for the transport built with:

- HTTP: `node dist/http.js`
- STDIO: `node dist/stdio.js`

Given the selected transport method, you will have a custom start script added to the `package.json` file.

For HTTP:

```bash
npm run start-http
# or
yarn start-http
# or
pnpm start-http
```

For STDIO:

```bash
npm run start-stdio
# or
yarn start-stdio
# or
pnpm start-stdio
```

## Learn More

- [xmcp Documentation](https://xmcp.dev/docs)
