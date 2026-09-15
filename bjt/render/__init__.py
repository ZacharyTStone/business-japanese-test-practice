"""Document stimuli: the data model, the templates, and the renderer.

The four reading and listening-reading types put a business document in front of
the learner. It is **data**, never a picture — see ``html.py`` for why that is
not a preference.

    from bjt import render

    render.validate_document(doc)      # problems with a document, [] == valid
    render.render(doc)                 # -> an HTML fragment for the app
    render.render_page(doc)            # -> a standalone page, for looking at it
    render.document_schema()           # -> the schema the model emits against
    render.TEMPLATES                   # -> the eight templates
"""
from .document import (  # noqa: F401
    BLOCK_TYPES,
    CALLOUT_TONES,
    document_schema,
    text_of,
    validate_document,
)
from .html import render, render_block, render_page  # noqa: F401
from .templates import TEMPLATES, Template, for_item_type, spec  # noqa: F401
