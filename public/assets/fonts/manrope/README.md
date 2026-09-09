# Manrope web fonts

Copyright 2018 The Manrope Project Authors. Distributed under the SIL Open Font License 1.1; see `OFL.txt`.

Source: [Google Fonts / Manrope](https://github.com/google/fonts/tree/fb629caaa15ad25c051089c98f09cf6c8e30a86b/ofl/manrope), `Manrope[wght].ttf`.

Source SHA-256: `d0639be45d0af36e798172419d7bd173c4bd4f29e2b76cbb69db1d11bf8b0a40`.

Generated 2026-09-09 with fontTools 4.64.0 and Brotli 1.2.0. These are static instances at weights 400, 500, 600 and 700; variable tables are removed. The four files total 91,140 bytes. Static instances fix the observed incorrect weight rendering of the remote variable font in Playwright WebKit on Windows. They also keep public typography independent of an external font service.

Reproduction: load the source with `fontTools.ttLib.TTFont`, call `fontTools.varLib.instancer.instantiateVariableFont(font, {'wght': weight}, inplace=True, updateFontNames=True)`, then subset with `fontTools.subset` and save with `font.flavor = 'woff2'`. Preserve all layout features and name records. Unicode coverage: U+0000–024F, U+0400–052F, U+2000–206F, U+20A0–20CF, U+2100–214F, U+2190–21FF, U+2212, U+FEFF and U+FFFD. This includes Latin, Cyrillic, punctuation and currency symbols used by the public site.

`font-display: optional` and the existing asynchronous stylesheet activation are preserved. All four weights (400/500/600/700) are preloaded: weight 500 is used in leads and technical text, and must be available before the optional-font deadline to keep line wrapping consistent. URLs are relative to this stylesheet so both root-domain and repository-base deployments work.
