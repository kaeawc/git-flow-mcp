# Project Validation

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
