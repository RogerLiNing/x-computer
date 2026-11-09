The original five parser regression fixtures below are synthetic, generated locally with ReportLab 4.0.4 (`invariant=1`); they contain no user documents.

- `text-pages.pdf`: Chinese/English text on physical pages 1 and 3; page 2 has no text. Uses the standard `STSong-Light` CID font.
- `no-text.pdf`: a drawn rectangle without a text layer. It checks the unread-content warning, not OCR accuracy.
- `password.pdf`: encrypted sample; test-only password `fixture-only-password`. The reader intentionally does not request or persist passwords.
- `too-many-pages.pdf`: 201 empty pages.
- `too-much-text.pdf`: 100 pages, each with 100 lines of 200 ASCII characters at 3 pt; exceeds the 1 MiB extraction limit.

The original parser tests retain the source bytes and verify read-only extraction. Visual reconstruction, OCR and editing are outside the original five fixtures' scope.


Additional OCR fixtures (synthetic, created with ReportLab and rasterized Chinese text, no user data):

- `scanned-pages.pdf`: page 1 has a Chinese bitmap containing `OCR-SCAN-8264` and no text layer; page 2 has the text-layer marker `TEXT_LAYER_LAST_PAGE_726`.
- `scanned-mixed-pages.pdf`: a scanned Chinese bitmap containing `MIXED-SCAN-9172` and a separate `TEXT_FOOTER_PAGE_1` text layer on the same page. It prevents a footer from suppressing OCR of the scan.

The OCR tests verify both native recognition and cancellation/error behavior. They do not establish accuracy on handwriting, complex layouts or real business documents.
