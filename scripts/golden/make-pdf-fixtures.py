# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 PT Perkasa Pilar Utama
"""Structured text-layer PDFs for the layout goldens (run once, output committed).

OCR pages carry no fonts, rules or links, so they leave most of projection and
markdown layout unexercised. These pages do: headings, ordered and bulleted
lists, a ruled and a borderless table, code, bold and italic runs, a link, a
superscript footnote marker, two columns, and three pages with a repeated
header and footer.

    uv run --with reportlab==4.4.4 python -I scripts/golden/make-pdf-fixtures.py tests/fixtures/pages
"""

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    ListFlowable,
    ListItem,
)

OUT = Path(sys.argv[1])
SS = getSampleStyleSheet()
BODY = SS["BodyText"]
CODE = ParagraphStyle("code", parent=SS["Code"], fontName="Courier", fontSize=9)


def structured() -> None:
    doc = SimpleDocTemplate(str(OUT / "structured.pdf"), pagesize=letter, title="Field Station Manual")
    s = [
        Paragraph("Field Station Manual", SS["Title"]),
        Paragraph("1. Getting started", SS["Heading1"]),
        Paragraph(
            "Every visitor signs the logbook on arrival. The station keeps <b>three rooms</b> open all "
            "year and a fourth from <i>April to October</i>. Read the "
            '<a href="https://example.org/station-rules" color="blue">station rules</a> before your first '
            "night.<super>1</super>",
            BODY,
        ),
        Paragraph("1.1 What to bring", SS["Heading2"]),
        ListFlowable(
            [ListItem(Paragraph(t, BODY)) for t in ["A sleeping bag rated to minus five", "Boots with a firm sole", "Your own water bottle"]],
            bulletType="bullet",
        ),
        Paragraph("1.2 Arrival steps", SS["Heading2"]),
        ListFlowable(
            [ListItem(Paragraph(t, BODY)) for t in ["Park at the lower gate.", "Walk the last 400 m on the marked path.", "Report to the warden's office."]],
            bulletType="1",
        ),
        Paragraph("2. Room rates", SS["Heading1"]),
    ]
    t = Table(
        [["Room", "Beds", "Rate per night", "Season"], ["North", "4", "18.00", "All year"], ["South", "2", "22.50", "All year"], ["Loft", "6", "12.00", "Apr-Oct"], ["Annex", "3", "15.75", "All year"]],
        colWidths=[3.5 * cm, 2 * cm, 4 * cm, 3.5 * cm],
    )
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.6, colors.black), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]))
    s += [t, Spacer(1, 12), Paragraph("3. Generator check", SS["Heading1"])]
    s.append(Preformatted("def check(load_kw):\n    if load_kw > 4.5:\n        return 'reduce load'\n    return 'ok'", CODE))
    s.append(Spacer(1, 12))
    s.append(Paragraph("<super>1</super> The rules change each spring; ask the warden for the current copy.", ParagraphStyle("fn", parent=BODY, fontSize=8)))
    doc.build(s)


def borderless() -> None:
    doc = SimpleDocTemplate(str(OUT / "borderless.pdf"), pagesize=A4)
    s = [Paragraph("Monthly readings", SS["Heading1"]), Paragraph("Rain gauge totals at the three posts, in millimetres.", BODY), Spacer(1, 8)]
    rows = [["Month", "Upper post", "Middle post", "Lower post"]] + [[m, f"{40 + i * 7}.{i}", f"{35 + i * 5}.{i + 2}", f"{20 + i * 3}.{i + 4}"] for i, m in enumerate(["January", "February", "March", "April", "May", "June"])]
    t = Table(rows, colWidths=[4 * cm, 3.5 * cm, 3.5 * cm, 3.5 * cm])
    t.setStyle(TableStyle([("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]))
    s += [t, Spacer(1, 10), Paragraph("Readings are taken at nine in the morning.", BODY)]
    doc.build(s)


def multipage() -> None:
    def chrome(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.drawString(2 * cm, A4[1] - 1.2 * cm, "Ridge Survey Annual Report")
        canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
        canvas.restoreState()

    doc = BaseDocTemplate(str(OUT / "multipage.pdf"), pagesize=A4)
    w = (A4[0] - 4 * cm - 0.8 * cm) / 2
    frames = [Frame(2 * cm, 2 * cm, w, A4[1] - 4 * cm, id="l"), Frame(2 * cm + w + 0.8 * cm, 2 * cm, w, A4[1] - 4 * cm, id="r")]
    doc.addPageTemplates([PageTemplate(id="two", frames=frames, onPage=chrome)])
    s = [Paragraph("Annual report", SS["Heading1"])]
    words = "The survey team walked each section of the ridge and counted the springs that still ran at the end of the dry season".split()
    # enough text for three pages, so the repeated header and footer are detected across pages
    for k in range(30):
        s.append(Paragraph(f"Section {k + 1}", SS["Heading3"]))
        line = " ".join(words[(k * 3) % 10:] + words[: (k * 3) % 10])
        s.append(Paragraph(f"{line}. {line}. Section {k + 1} held {k + 3} springs.", BODY))
    doc.build(s)


OUT.mkdir(parents=True, exist_ok=True)
structured()
borderless()
multipage()
print("wrote structured.pdf, borderless.pdf, multipage.pdf")
