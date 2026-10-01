# Legacy compatibility reference

The production editor lives under `native/`. JavaScript under `src/`, the
`product-host/`, `desktop/` and browser entry point are retained as compatibility
references during #118/#142. They receive no new production responsibilities.

The old managed `Flamoris2D.ProductHost.Client` and its tests are also reference
code, excluded from the production native solution and publish graph. npm
dependencies are test-only. `npm test` checks the reference behavior; it does not
launch or build the native application.

No native package may include these sources, Node or Electron. Keep the oracle
until parity and physical Windows artwork acceptance permit its deletion.
See [renovation map](../docs/repository-renovation.md) for file-level disposition.
