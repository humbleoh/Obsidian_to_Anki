"""Embedded FiraCode subset (SIL Open Font License 1.1) covering only Unicode
ranges whose East_Asian_Width is Ambiguous: U+2500-259F (box-drawing + block
elements) and U+2190-21FF (arrows).

On CJK-locale mobile devices (AnkiDroid, AnkiMobile) these glyphs would
otherwise be rendered at 2 cells wide, breaking ASCII-art alignment. Embedding
the subset as base64 forces every platform to use identical 1-cell advance
widths for these specific characters. ASCII letters and CJK characters fall
through to the surrounding font stack (Courier New etc.).

Subset generated with:
    pyftsubset FiraCode-Regular.ttf \
        --unicodes="U+2500-259F,U+2190-21FF" \
        --layout-features-='*' --flavor=woff2 --no-hinting --desubroutinize

Result: 3.5KB woff2 / 4.7KB base64.
"""

TEXTGRAM_BOXART_FONT_B64 = (
    "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"
)

TEXTGRAM_BOXART_FONT_NAME = "TextgramBoxArt"

TEXTGRAM_BOXART_UNICODE_RANGE = "U+2500-259F, U+2190-21FF"


def build_textgram_font_face_style():
    """Return a <style> block defining the @font-face. Caller prepends this
    to the note HTML once per note (not once per block)."""
    return (
        "<style>\n"
        "@font-face {{\n"
        "    font-family: '{name}';\n"
        "    src: url(data:font/woff2;base64,{b64}) format('woff2');\n"
        "    font-style: normal;\n"
        "    font-weight: 400;\n"
        "    font-display: block;\n"
        "    unicode-range: {range};\n"
        "}}\n"
        "</style>"
    ).format(
        name=TEXTGRAM_BOXART_FONT_NAME,
        b64=TEXTGRAM_BOXART_FONT_B64,
        range=TEXTGRAM_BOXART_UNICODE_RANGE,
    )
