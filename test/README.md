# Test

Root `test/` is reserved for integration/system/staging tests that validate Product from outside its runtime dependency graph.

Deterministic local unit tests for the current v0.3 Product are kept under `product/tests/` and are excluded from production artifacts.

Add root integration tests only when several Product modules or an external environment must cooperate. Do not create a broad browser/system harness before the corresponding behavior is stable.
