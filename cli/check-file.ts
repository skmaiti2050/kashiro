import { run } from './run';

// Unconditional entry point: `npx tsx cli/check-file.ts <in> <out> [...]`.
process.exitCode = await run(process.argv.slice(2));
