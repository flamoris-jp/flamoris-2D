# Cutwork producer compatibility fixture

`cutwork-current-v2.flimg` is a synthetic archive emitted by the current Cutwork
archive writer. Its producer source revision and hashes are in
`cutwork-current-v2.provenance.json`. The committed seed uses the portable test
PNG encoder; Windows producer/consumer CI regenerates it using the actual Cutwork
WPF PNG encoder. See `test/compatibility/flimg/README.md` for regeneration.

`cutwork-current-v2.expectation.json` describes the expected manifest metadata and
the decoded, straight RGBA bytes for each layer. The oracle uses synthetic source
pixels and explicit alpha masks, independent of both application implementations.

Every ID starts with `15000000-0000-0000-0000-`; the final twelve digits below are
hexadecimal. Document ID is `000000000001`. Archive layer order is the table order.

| ID suffix | Kind | Bounds `(x,y,w,h)` | Semantic name | Important behavior |
| --- | --- | --- | --- | --- |
| `000000000003` | Part | `(1,1,4,3)` | `face.front` | Part order 9, gray alpha mask |
| `000000000004` | Part | `(3,2,3,3)` | `hair.back` | Part order 2, overlaps the first Part |
| `000000000005` | Part | `(0,4,2,2)` | `eye.closed` | Hidden, Part order 5 |
| `000000000002` | Base | `(0,0,8,6)` | `body.base` | Original alpha minus max Part coverage |
| `000000000006` | Patch | `(0,0,2,2)` | `patch.edge` | Center `(6,2)`, scale 1.25, rotation 30°, square source polygon |
| `000000000007` | Repair | `(1,1,2,2)` | `repair.face` | Owned by the first Part |
| `000000000008` | Repair | `(5,3,2,2)` | `repair.global` | No owner |
| `000000000009` | Repair | `(3,2,2,2)` | `repair.hidden` | Hidden, owned by the second Part |

The source at integer pixel `(x,y)` has `R=(17+23x+7y)%256`,
`G=(31+11x+29y)%256`, `B=(47+13x+5y)%256`, and
`A=[255,128,64,0][(x+2y)%4]`. Part alpha is
`floor((originalAlpha*mask+127)/255)`. Base alpha uses the maximum coverage
of **all** Parts, including hidden Parts, preserving exclusion semantics when
visibility changes. RGB remains straight even where alpha is zero.

The three explicit Part masks in row order are:

```text
front: 255,128,0,64,32,200,255,96,0,64,128,255
back:  96,255,32,0,128,224,255,64,0
hidden:255,0,128,64
```

Patch/Repair RGBA arrays are explicit constants in the generator. Their expected
images use source raster dimensions; Patch placement belongs to its transform.
The fixture includes partial and fully transparent pixels to protect straight
alpha handling, and semantic creation order differs from compositor stack order.
