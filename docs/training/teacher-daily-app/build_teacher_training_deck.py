#!/usr/bin/env python3
"""
Build teacher daily app training PowerPoint and one-page handout PDF.
Replace files in screenshots/ with real captures (same filenames) and re-run.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
SCREENSHOTS = ROOT / "screenshots"
MANIFEST = ROOT / "screenshot-manifest.json"
OUT_PPTX = ROOT / "Teacher-Daily-App-Training.pptx"
OUT_PDF = ROOT / "Teacher-Daily-App-Handout.pdf"

# App-aligned palette (Bootstrap primary + neutrals)
ACCENT = RGBColor(0x0D, 0x6E, 0xFD)
ACCENT_HEX = "#0d6efd"
DARK = RGBColor(0x21, 0x25, 0x29)
MUTED = RGBColor(0x6C, 0x75, 0x7D)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_BG = RGBColor(0xF3, 0xF8, 0xFF)
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


def load_manifest() -> dict:
    with MANIFEST.open(encoding="utf-8") as f:
        return json.load(f)


def try_font(size: int, bold: bool = False):
    names = ["segoeui.ttf", "Segoe UI.ttf", "arial.ttf", "Arial.ttf"]
    if bold:
        names = ["segoeuib.ttf", "Segoe UI Bold.ttf", "arialbd.ttf"] + names
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def ensure_placeholder_screenshots(manifest: dict) -> None:
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    title_font = try_font(36, bold=True)
    hint_font = try_font(22)
    num_font = try_font(28, bold=True)
    sub_font = try_font(18)

    for idx, shot in enumerate(manifest["shots"], start=1):
        path = SCREENSHOTS / shot["file"]
        if path.exists() and path.stat().st_size > 50_000:
            # Likely a real screenshot (placeholders are ~30-40kb); keep user replacements
            continue
        w, h = 1600, 900
        img = Image.new("RGB", (w, h), "#f8fbff")
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle((40, 40, w - 40, h - 40), radius=24, outline=ACCENT_HEX, width=4)
        draw.rounded_rectangle((60, 60, w - 60, h - 60), radius=16, fill="#ffffff", outline="#dce9ff", width=2)

        draw.text((80, 80), f"Screenshot {idx:02d}", fill=ACCENT_HEX, font=num_font)
        draw.text((80, 140), shot["title"], fill="#212529", font=title_font)
        draw.text((80, 210), shot["hint"], fill="#6c757d", font=hint_font)

        wrap_y = 280
        lines = [
            "Replace this file with your capture.",
            f"Filename: {shot['file']}",
            "Blur student names if shown.",
        ]
        for line in lines:
            draw.text((80, wrap_y), line, fill="#495057", font=sub_font)
            wrap_y += 32

        draw.text((80, h - 100), f"Slide {shot['slide']}", fill=ACCENT_HEX, font=sub_font)
        img.save(path, "PNG", optimize=True)


def set_slide_bg(slide, prs: Presentation, fill: RGBColor = WHITE) -> None:
    fill_el = slide.background.fill
    fill_el.solid()
    fill_el.fore_color.rgb = fill


def add_footer_bar(slide, prs: Presentation, text: str = "Teacher daily routine") -> None:
    shape = slide.shapes.add_shape(
        1,  # rectangle
        Inches(0),
        SLIDE_H - Inches(0.35),
        prs.slide_width,
        Inches(0.35),
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = ACCENT
    shape.line.fill.background()
    tf = shape.text_frame
    tf.text = text
    p = tf.paragraphs[0]
    p.font.size = Pt(11)
    p.font.color.rgb = WHITE
    p.font.name = "Segoe UI"
    p.alignment = PP_ALIGN.CENTER


def add_title_block(
    slide,
    title: str,
    subtitle: str | None = None,
    top: float = 0.45,
) -> None:
    box = slide.shapes.add_textbox(Inches(0.6), Inches(top), Inches(12.1), Inches(1.2))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(32)
    p.font.bold = True
    p.font.color.rgb = DARK
    p.font.name = "Segoe UI"
    if subtitle:
        p2 = tf.add_paragraph()
        p2.text = subtitle
        p2.font.size = Pt(18)
        p2.font.color.rgb = MUTED
        p2.font.name = "Segoe UI"
        p2.space_before = Pt(6)


def add_bullets(slide, items: list[str], left: float = 0.65, top: float = 1.55, width: float = 5.8, size: int = 20):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(5.2))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = item
        p.level = 0
        p.font.size = Pt(size)
        p.font.color.rgb = DARK
        p.font.name = "Segoe UI"
        p.space_after = Pt(10)
        p.bullet = True


def add_image_placeholder(
    slide,
    image_path: Path,
    left: float,
    top: float,
    width: float,
    height: float,
) -> None:
    if image_path.exists():
        slide.shapes.add_picture(str(image_path), Inches(left), Inches(top), width=Inches(width), height=Inches(height))


def add_speaker_notes(slide, text: str) -> None:
    notes = slide.notes_slide.notes_text_frame
    notes.text = text


def build_presentation(manifest: dict) -> Presentation:
    completed = manifest.get("completedStatusLabel", "Completed")
    prs = Presentation()
    prs.slide_width = int(SLIDE_W)
    prs.slide_height = int(SLIDE_H)
    blank = prs.slide_layouts[6]

    shots_by_slide: dict[int, list[Path]] = {}
    for shot in manifest["shots"]:
        shots_by_slide.setdefault(shot["slide"], []).append(SCREENSHOTS / shot["file"])

    # Slide 1 — Title
    s1 = prs.slides.add_slide(blank)
    set_slide_bg(s1, prs, LIGHT_BG)
    accent = s1.shapes.add_shape(1, Inches(0), Inches(0), Inches(0.25), SLIDE_H)
    accent.fill.solid()
    accent.fill.fore_color.rgb = ACCENT
    accent.line.fill.background()
    tbox = s1.shapes.add_textbox(Inches(0.9), Inches(2.2), Inches(11.5), Inches(2.5))
    tf = tbox.text_frame
    p = tf.paragraphs[0]
    p.text = "Your daily routine in the school app"
    p.font.size = Pt(44)
    p.font.bold = True
    p.font.color.rgb = DARK
    p.font.name = "Segoe UI"
    p2 = tf.add_paragraph()
    p2.text = "Schedule Overview → Manage Session → Save"
    p2.font.size = Pt(24)
    p2.font.color.rgb = ACCENT
    p2.font.name = "Segoe UI"
    p2.space_before = Pt(16)
    p3 = tf.add_paragraph()
    p3.text = "For teachers"
    p3.font.size = Pt(16)
    p3.font.color.rgb = MUTED
    p3.font.name = "Segoe UI"
    p3.space_before = Pt(28)
    add_footer_bar(s1, prs, "See schedule → Open session → Do work → Set status → Save")
    add_speaker_notes(s1, "Today is only what you do most days—not every admin feature.")

    # Slide 2 — Goals
    s2 = prs.slides.add_slide(blank)
    set_slide_bg(s2, prs)
    add_title_block(s2, "What you'll learn")
    add_bullets(
        s2,
        [
            "Find your sessions for today or this week",
            "Open Manage Session for each class",
            f"Finish with the right session status ({completed}) and Save session",
        ],
        top=1.65,
        width=11.5,
    )
    # Icon strip
    for i, label in enumerate(["Schedule", "Class", "Done"]):
        sh = s2.shapes.add_shape(1, Inches(1.2 + i * 3.8), Inches(5.5), Inches(2.8), Inches(1.1))
        sh.fill.solid()
        sh.fill.fore_color.rgb = LIGHT_BG
        sh.line.color.rgb = ACCENT
        tf = sh.text_frame
        tf.text = label
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        tf.paragraphs[0].font.size = Pt(22)
        tf.paragraphs[0].font.color.rgb = ACCENT
        tf.paragraphs[0].font.bold = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    add_footer_bar(s2, prs)
    add_speaker_notes(s2, "If you can use email, you can do this.")

    # Slide 3
    s3 = prs.slides.add_slide(blank)
    set_slide_bg(s3, prs)
    add_title_block(s3, "Where to start", "School dashboard")
    add_bullets(
        s3,
        [
            "Log in → open School section",
            "Find card My Schedule Overview",
            "Click Open My Schedule",
        ],
    )
    add_image_placeholder(s3, shots_by_slide[3][0], 6.5, 1.45, 6.2, 5.0)
    add_footer_bar(s3, prs)
    add_speaker_notes(s3, "This is the only front door they need for planning.")

    # Slide 4
    s4 = prs.slides.add_slide(blank)
    set_slide_bg(s4, prs)
    add_title_block(s4, "Schedule Overview at a glance", "What am I teaching, when, and what's already done?")
    add_bullets(
        s4,
        [
            "Page heading: Schedule Overview",
            "My Profile / Self View (always you)",
            "Summary: Active Range, hours, Items",
            "Table: Session Details",
        ],
        width=5.5,
    )
    add_image_placeholder(s4, shots_by_slide[4][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s4, prs)
    add_speaker_notes(s4, "Date, Time, Class, Status are enough—they don't need every column.")

    # Slide 5
    s5 = prs.slides.add_slide(blank)
    set_slide_bg(s5, prs)
    add_title_block(s5, "Set your filters")
    add_bullets(
        s5,
        [
            "1. Anchor Date — often today",
            "2. Period — Daily, Weekly, Monthly, Seasonal, or Yearly",
            "3. Optional: With cases only (if your school uses cases)",
            "4. Click Load",
            "",
            "Tip: No list? Check Anchor Date + period, then Load again.",
        ],
        size=18,
    )
    add_image_placeholder(s5, shots_by_slide[5][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s5, prs)
    add_speaker_notes(s5, "Weekly + today's anchor for Monday planning; Daily on teaching days.")

    # Slide 6
    s6 = prs.slides.add_slide(blank)
    set_slide_bg(s6, prs)
    add_title_block(s6, "Read your schedule", "Session Details")
    add_bullets(
        s6,
        [
            "Each row = one class session",
            "Status shows open vs done (colors)",
            "Role should show Teacher for sessions you lead",
        ],
    )
    add_image_placeholder(s6, shots_by_slide[6][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s6, prs)
    add_speaker_notes(s6, "Scan status summary pills above the table when present.")

    # Slide 7
    s7 = prs.slides.add_slide(blank)
    set_slide_bg(s7, prs)
    add_title_block(s7, "Open Manage Session")
    add_bullets(
        s7,
        [
            "Click the session row (or Details)",
            "You land on Manage Session for that date and time",
        ],
    )
    add_image_placeholder(s7, shots_by_slide[7][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s7, prs)
    add_speaker_notes(s7, "One session at a time—same steps every class.")

    # Slide 8
    s8 = prs.slides.add_slide(blank)
    set_slide_bg(s8, prs)
    add_title_block(s8, "Manage Session — quick tour")
    add_bullets(
        s8,
        [
            "Top: class name, date, time",
            "Session status (Required until finished)",
            "Left menu: work areas",
            "Save session and Close",
        ],
        width=5.5,
    )
    add_image_placeholder(s8, shots_by_slide[8][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s8, prs)
    add_speaker_notes(s8, "Next slide is the daily checklist.")

    # Slide 9 — two images
    s9 = prs.slides.add_slide(blank)
    set_slide_bg(s9, prs)
    add_title_block(s9, "During class — your checklist")
    add_bullets(
        s9,
        [
            "Attendance — mark Present, Late, Absent, etc.",
            "Class Conduct — if your school requires it",
            "Session & notes — what happened today",
            "Curriculum — Covered content (what you taught)",
            "Reports, Book coverage, Student Cases — if you see them",
        ],
        width=5.6,
        size=17,
    )
    imgs9 = shots_by_slide.get(9, [])
    if len(imgs9) >= 1:
        add_image_placeholder(s9, imgs9[0], 6.25, 1.35, 3.05, 2.45)
    if len(imgs9) >= 2:
        add_image_placeholder(s9, imgs9[1], 9.45, 1.35, 3.05, 2.45)
    add_footer_bar(s9, prs)
    add_speaker_notes(s9, "If a section is missing, focus on what you see on screen.")

    # Slide 10
    s10 = prs.slides.add_slide(blank)
    set_slide_bg(s10, prs)
    add_title_block(s10, "Save as you go")
    add_bullets(
        s10,
        [
            "Tap Save session after attendance, notes, or curriculum changes",
            "Leaving without saving can lose work — Close may warn you",
        ],
    )
    # Reuse manage session image cropped area — use shot 06
    add_image_placeholder(s10, shots_by_slide[8][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s10, prs)
    add_speaker_notes(s10, "Save before switching sessions or closing the browser tab.")

    # Slide 11
    s11 = prs.slides.add_slide(blank)
    set_slide_bg(s11, prs)
    add_title_block(s11, f"Finish the session — set status to {completed}")
    add_bullets(
        s11,
        [
            "Open Session status at the top of Manage Session",
            f"Choose {completed} (your school's completed status)",
            "Confirm Session completed check by the title when shown",
            "Click Save session again",
        ],
        width=5.6,
    )
    imgs11 = shots_by_slide.get(11, [])
    if len(imgs11) >= 1:
        add_image_placeholder(s11, imgs11[0], 6.25, 1.35, 3.1, 2.5)
    if len(imgs11) >= 2:
        add_image_placeholder(s11, imgs11[1], 9.55, 1.35, 3.1, 2.5)
    add_footer_bar(s11, prs)
    add_speaker_notes(s11, "Status is not the same as attendance—you need both where required.")

    # Slide 12
    s12 = prs.slides.add_slide(blank)
    set_slide_bg(s12, prs)
    add_title_block(s12, "Back on Schedule Overview — verify")
    add_bullets(
        s12,
        [
            "Return to Schedule Overview → Load (or refresh)",
            f"That row's Status should show {completed}",
        ],
    )
    add_image_placeholder(s12, shots_by_slide[12][0], 6.3, 1.35, 6.4, 5.15)
    add_footer_bar(s12, prs)
    add_speaker_notes(s12, "This is how you know you're caught up for the week.")

    # Slide 13
    s13 = prs.slides.add_slide(blank)
    set_slide_bg(s13, prs)
    add_title_block(s13, "Quick fixes — keep calm")
    add_bullets(
        s13,
        [
            "I don't see my class → wrong Anchor Date / period / forgot Load",
            "I can't change status → session locked or edit window closed — contact office",
            "Save is disabled → session may be read-only — contact office for corrections",
        ],
        width=11,
        size=22,
    )
    help_box = s13.shapes.add_shape(1, Inches(0.65), Inches(5.2), Inches(11.9), Inches(1.3))
    help_box.fill.solid()
    help_box.fill.fore_color.rgb = LIGHT_BG
    help_box.line.color.rgb = ACCENT
    tf = help_box.text_frame
    tf.text = "Need help? Contact your school office or IT support."
    tf.paragraphs[0].font.size = Pt(20)
    tf.paragraphs[0].font.color.rgb = DARK
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    add_footer_bar(s13, prs)
    add_speaker_notes(s13, "Normalize asking for help—reduces fear of breaking the app.")

    # Slide 14 — Recap
    s14 = prs.slides.add_slide(blank)
    set_slide_bg(s14, prs, LIGHT_BG)
    add_title_block(s14, "Your daily routine — recap", top=0.55)
    steps = [
        "Open My Schedule",
        "Anchor Date + period → Load",
        "Click session → Manage Session",
        "Attendance · Notes · Curriculum (and other visible sections)",
        f"Session status = {completed} → Save session",
    ]
    y = 1.75
    for i, step in enumerate(steps, start=1):
        circ = s14.shapes.add_shape(9, Inches(0.75), Inches(y), Inches(0.55), Inches(0.55))
        circ.fill.solid()
        circ.fill.fore_color.rgb = ACCENT
        circ.line.fill.background()
        tf = circ.text_frame
        tf.text = str(i)
        tf.paragraphs[0].font.size = Pt(18)
        tf.paragraphs[0].font.bold = True
        tf.paragraphs[0].font.color.rgb = WHITE
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tb = s14.shapes.add_textbox(Inches(1.45), Inches(y - 0.05), Inches(10.5), Inches(0.65))
        tb.text_frame.text = step
        tb.text_frame.paragraphs[0].font.size = Pt(22)
        tb.text_frame.paragraphs[0].font.color.rgb = DARK
        tb.text_frame.paragraphs[0].font.name = "Segoe UI"
        y += 0.95
    if shots_by_slide.get(3):
        add_image_placeholder(s14, shots_by_slide[3][0], 8.8, 1.5, 3.9, 2.0)
    add_footer_bar(s14, prs, "Handout: save this slide as PDF for your desk")
    add_speaker_notes(s14, "Offer 5 minutes hands-on if training is in person.")

    return prs


def build_handout_pdf(manifest: dict) -> None:
    completed = manifest.get("completedStatusLabel", "Completed")
    c = canvas.Canvas(str(OUT_PDF), pagesize=letter)
    w, h = letter
    margin = 0.75 * inch

    c.setFillColor(colors.HexColor(ACCENT_HEX))
    c.rect(0, h - 0.45 * inch, w, 0.45 * inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(w / 2, h - 0.32 * inch, "Teacher daily routine — quick reference")

    c.setFillColor(colors.HexColor("#212529"))
    c.setFont("Helvetica-Bold", 22)
    c.drawString(margin, h - 1.15 * inch, "Your daily routine in the school app")

    c.setFont("Helvetica", 12)
    c.setFillColor(colors.HexColor("#6c757d"))
    c.drawString(margin, h - 1.45 * inch, "Schedule Overview → Manage Session → Save")

    steps = [
        "Open My Schedule (School dashboard → My Schedule Overview)",
        "Set Anchor Date, choose period (Daily / Weekly / …), click Load",
        "Click a session row → Manage Session",
        "Complete Attendance, Session & notes, Curriculum (and other sections you see)",
        f"Set Session status to {completed}, then Save session",
        "Return to Schedule Overview and confirm the row shows {completed}",
    ]
    y = h - 2.1 * inch
    c.setFillColor(colors.HexColor("#212529"))
    for i, step in enumerate(steps, start=1):
        c.setFillColor(colors.HexColor(ACCENT_HEX))
        c.circle(margin + 8, y + 4, 10, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(margin + 8, y, str(i))
        c.setFillColor(colors.HexColor("#212529"))
        c.setFont("Helvetica", 13)
        c.drawString(margin + 28, y - 2, step)
        y -= 0.55 * inch

    c.setFillColor(colors.HexColor("#6c757d"))
    c.setFont("Helvetica-Oblique", 10)
    c.drawString(margin, 0.9 * inch, "Problems? Check Anchor Date and Load first. Contact your school office if status or Save is blocked.")

    c.showPage()
    c.save()


def main() -> None:
    manifest = load_manifest()
    ensure_placeholder_screenshots(manifest)
    prs = build_presentation(manifest)
    prs.save(str(OUT_PPTX))
    build_handout_pdf(manifest)
    print(f"Wrote {OUT_PPTX}")
    print(f"Wrote {OUT_PDF}")
    print(f"Screenshots in {SCREENSHOTS}")


if __name__ == "__main__":
    main()
