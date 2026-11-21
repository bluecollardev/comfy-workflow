# CANALV2 Tunnel V11: push readiness (2026-11-21 18:51 Bangkok time)

Read-only snapshot of `s3://bh-panama-exchange-610140802195/returns/BKK/tunnel-v11-edl-2026-11-18/` written by `scripts/delivery-readiness.py`: per element the DPX frames against the PDF count, the ProRes and H.264 review videos and the element manifest. **17 of 35 targeted elements have everything** (frames, ProRes, H.264, manifest); f23 is deferred. A missing H.264 or ProRes is a review-video gap, not a frame gap.

| # | Element | DPX in round / PDF | ProRes | H.264 | Manifest | Ready to push |
|---|---|---|---|---|---|---|
| 1 | ARCHIVAL-071_MAIN | 227 / 227 | yes | yes | 2026-11-21 03:03 | yes |
| 2 | ARCHIVAL-077_A | 80 / 80 | yes | yes | 2026-11-21 03:16 | yes |
| 3 | ARCHIVAL-077_B | 69 / 69 | yes | yes | 2026-11-21 03:16 | yes |
| 4 | ARCHIVAL-077_C | 74 / 74 | yes | yes | 2026-11-21 03:16 | yes |
| 5 | ARCHIVAL-080_A | 94 / 94 | yes | yes | 2026-11-21 03:38 | yes |
| 6 | ARCHIVAL-080_B | 60 / 60 | yes | yes | 2026-11-21 03:38 | yes |
| 7 | ARCHIVAL-080_C | 90 / 90 | yes | yes | 2026-11-21 03:38 | yes |
| 8 | ARCHIVAL-080_D | 83 / 83 | yes | yes | 2026-11-21 03:38 | yes |
| 9 | ARCHIVAL-080_E | 44 / 44 | yes | yes | 2026-11-21 03:38 | yes |
| 10 | ARCHIVAL-083_MAIN | 98 / 98 | yes | yes | 2026-11-21 03:44 | yes |
| 11 | ARCHIVAL-084_MAIN | 39 / 39 | yes | yes | 2026-11-21 03:46 | yes |
| 12 | ARCHIVAL-085_MAIN | 54 / 54 | yes | yes | 2026-11-21 03:49 | yes |
| 13 | ARCHIVAL-093_B | 126 / 126 | yes | yes | 2026-11-21 03:56 | yes |
| 14 | ARCHIVAL-102_MAIN | 128 / 128 | yes | yes | 2026-11-21 04:04 | yes |
| 15 | ARCHIVAL-104_B | 130 / 130 | yes | yes | 2026-11-21 04:12 | yes |
| 16 | ARCHIVAL-123_C | 66 / 66 | yes | yes | 2026-11-21 14:13 | yes |
| 17 | CGI-042_MAIN | 229 / 229 | yes | yes | 2026-11-21 04:30 | yes |
| 18 | ARCHIVAL-087_PLATFORM | 97 / 97 | no | no | 2026-11-21 14:11 | missing: ProRes, H.264 |
| 19 | ARCHIVAL-087_RAIN | 96 / 96 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 20 | ARCHIVAL-123_F | 43 / 43 | no | no | 2026-11-21 14:13 | missing: ProRes, H.264 |
| 21 | ARCHIVAL-168_A | 153 / 153 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 22 | ARCHIVAL-168_B | 139 / 139 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 23 | ARCHIVAL-168_C | 105 / 105 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 24 | ARCHIVAL-168_D | 48 / 48 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 25 | CREATURE-266_DOLPHIN-LOWTRACK | 94 / 94 | no | no | 2026-11-21 14:13 | missing: ProRes, H.264 |
| 26 | PHOTOREAL-013_ASCENT | 108 / 108 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 27 | PHOTOREAL-013_CHASM07 | 271 / 271 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 28 | PHOTOREAL-013_SPLASH | 96 / 96 | no | no | 2026-11-21 14:12 | missing: ProRes, H.264 |
| 29 | CGI-072_BACKHALF-B | 70 / 70 | no | no | 2026-11-21 16:49 | missing: ProRes, H.264 |
| 30 | CGI-072_HEAD | 106 / 106 | no | no | 2026-11-21 17:27 | missing: ProRes, H.264 |
| 31 | PHOTOREAL-013_HADAL | 160 / 160 | no | no | 2026-11-21 17:42 | missing: ProRes, H.264 |
| 32 | CGI-072_BACKHALF-C | 162 / 162 | no | no | 2026-11-21 18:22 | missing: ProRes, H.264 |
| 33 | PHOTOREAL-013_LANDING | 0 / 226 ✗ | no | no | no | missing: frames, ProRes, H.264, manifest |
| 34 | PHOTOREAL-013_SUNLIGHT | 0 / 212 ✗ | no | no | no | missing: frames, ProRes, H.264, manifest |
| 35 | PHOTOREAL-013_TOP | 0 / 209 ✗ | no | no | no | missing: frames, ProRes, H.264, manifest |
| 36 | PHOTOREAL-013_F23 | 0 / 633 ✗ | no | no | no | deferred (f23) |
