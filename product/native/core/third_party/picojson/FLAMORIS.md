# FLAMORIS private JSON patch

Based on picojson commit `111c9be5188f7350c2eac9ddaedd8cca3d7bf394`.
The original BSD-2-Clause license remains alongside the header.

Native Product builds use C++17. The private object representation retains
property insertion order across parsing, copies, writes, erases and serialization.
`keys()` enumerates ECMAScript array-index keys first, then other keys in insertion
order. Lexical lookup/iteration and semantic equality remain available; map
mutation methods are wrapped so they cannot bypass key-order bookkeeping.

This is required for source re-import affected-ID order, ordinary inverse/history
copies and native query enumeration. It replaces the validation-only pointer
order map in `project_snapshot.cpp`; no Project data field is added.

The default parser decrements object depth as well as array depth. This preserves
the existing Project admission depth limit while applying it consistently to
command input. The original size and UTF-8 limits remain at the C ABI boundary.

Current JS-derived Project and session corpora protect the observable behavior,
including integer-like names, astral IDs, typed creation, inverse copies,
replacement and serialization round trips.
