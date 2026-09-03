import sys
from docx import Document
from docx.oxml.ns import qn

path = sys.argv[1]
idxs = [int(x) for x in sys.argv[2:]]
doc = Document(path)
for pi, p in enumerate(doc.paragraphs):
    if pi in idxs:
        print(f"=== paragraph {pi} ===")
        for ri, r in enumerate(p.runs):
            rpr = r._element.find(qn('w:rPr'))
            hl = None
            if rpr is not None:
                h = rpr.find(qn('w:highlight'))
                if h is not None:
                    hl = h.get(qn('w:val'))
            print(ri, 'hl=', hl, repr(r.text))
