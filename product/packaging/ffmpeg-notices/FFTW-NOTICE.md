# FFTW evidence in the pinned BtbN FFmpeg build

FFTW is copyright (c) 2003, 2007-14 Matteo Frigo and copyright (c) 2003, 2007-14
Massachusetts Institute of Technology. FFTW's implementation is licensed under
GNU GPL version 2 or later, without warranty. The bundled `COPYING.GPLv2.txt`
is the unmodified license from the exact source revision below; GPLv3 terms are
also retained as `COPYING.GPLv3.txt`.

Source: https://github.com/FFTW/fftw3/tree/93ed4c786934aec9946f8dda4b4e3eb08f8be41c
Copyright/license example:
https://github.com/FFTW/fftw3/blob/93ed4c786934aec9946f8dda4b4e3eb08f8be41c/kernel/twiddle.c

The pinned BtbN `scripts.d/25-fftw3.sh` builds static FFTW unconditionally.
`scripts.d/50-chromaprint.sh` builds static Chromaprint with `-DFFT_LIB=fftw3`
and adds `-lfftw3` to its private link flags. The configuration embedded in the
distributed FFmpeg enables Chromaprint with static pkg-config dependencies.
The exact `avformat-63.dll` contains FFTW wisdom/version and implementation strings.

These facts prevent this audit from certifying the upstream archive as LGPL-only,
despite its filename, license file and FFmpeg configure flags. They require
resolution of the transitive GPL licensing question and corresponding-source
delivery before a supported public release. Including license texts is not itself
a complete source offer or a legal attestation. See `SOURCE-ACCESS.md` and Issue #149.
