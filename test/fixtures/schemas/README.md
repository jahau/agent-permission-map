# Schema fixtures

One file per supported format, shaped after the vendor documentation checked on
2026-11-18 (see `docs/supported-configs.md`). `test/schemas.test.ts` asserts what each
fixture normalizes to, so a parser change that drops a field fails a test.
