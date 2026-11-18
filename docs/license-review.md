# License review

Reviewed 2026-11-18 for version 0.1.0.

## Project license

The project is licensed under the Apache License, Version 2.0. `LICENSE` is the unmodified
canonical text from <https://www.apache.org/licenses/LICENSE-2.0.txt>
(SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`).
`NOTICE` carries the attribution required by section 4(d) for redistributors.
`package.json` declares `"license": "Apache-2.0"`.

Source files do not carry per-file license headers. Apache-2.0 does not require them. The
`LICENSE` and `NOTICE` files ship in the npm package (`files` in `package.json`).

## Dependencies

| Package | Version | Kind | License | Compatible with Apache-2.0 distribution | Notes |
| --- | --- | --- | --- | --- | --- |
| `jsonc-parser` | 3.3.1 | runtime | MIT | Yes | Microsoft. No dependencies. Used for JSON with comments (VS Code `mcp.json`) and error positions. |
| `smol-toml` | 1.9.1 | runtime | BSD-3-Clause | Yes | No dependencies. Used for Codex `config.toml`. BSD-3-Clause requires keeping its copyright notice, which is in the installed package's `LICENSE`. We do not bundle or vendor it. |
| `typescript` | 5.9.x | dev | Apache-2.0 | Yes | Build only, not distributed. |
| `@types/node` | 22.x | dev | MIT | Yes | Build only, not distributed. |
| `undici-types` | (transitive of `@types/node`) | dev | MIT | Yes | Type declarations only. |

Both runtime dependencies are installed by npm from the registry alongside this package. Neither
is copied into `dist/`, so their own license files travel with them.

## Ongoing check

`npm run licenses` (`scripts/check-licenses.mjs`) reads `package-lock.json` and each installed
package's `package.json`, and fails if a license is outside this allowlist: MIT, ISC,
BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense. It runs in CI and
makes no network requests.

## Third-party material in the repository

- Fixtures in `fixtures/` and `test/fixtures/` were written for this project. Their *shape*
  follows public vendor documentation (listed in [supported-configs.md](supported-configs.md)),
  but no documentation text is copied.
- No vendor logos, trademarks or code are included. Agent names are used only to identify
  which files are read.
