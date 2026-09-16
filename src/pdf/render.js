const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', '..', 'fonts');

const MARGIN = 50; // book-like density on A5 — 1 inch (72pt) reads as sparse/bloated on this trim size

function registerFonts(doc) {
  doc.registerFont('Body', path.join(FONTS_DIR, 'PTSerif-Regular.ttf'));
  doc.registerFont('Body-Bold', path.join(FONTS_DIR, 'PTSerif-Bold.ttf'));
  doc.registerFont('Body-Italic', path.join(FONTS_DIR, 'PTSerif-Italic.ttf'));
  doc.registerFont('Body-BoldItalic', path.join(FONTS_DIR, 'PTSerif-BoldItalic.ttf'));
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.author - byline, e.g. source game + style reference
 * @param {{ heading: string, body: string }[]} opts.chapters
 * @param {string} opts.outPath
 */
function renderNovelPdf({ title, author, chapters, outPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      size: 'A5',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });
    registerFonts(doc);

    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);

    // --- Title page ---
    doc.addPage();
    doc.font('Body-Bold').fontSize(26).text(title, { align: 'center' });
    doc.moveDown(2);
    doc.font('Body-Italic').fontSize(13).text(author, { align: 'center' });
    doc.moveDown(6);
    doc.font('Body').fontSize(9).text(
      'Сгенерировано автоматически. Личный экземпляр, без распространения.',
      { align: 'center' }
    );

    // --- Table of contents (placeholder, filled in after body renders) ---
    doc.addPage();
    const tocPageIndex = doc.bufferedPageRange().count - 1;
    doc.font('Body-Bold').fontSize(18).text('Оглавление');
    doc.moveDown();

    // --- Chapters ---
    const tocEntries = [];
    for (const ch of chapters) {
      doc.addPage();
      const pageIndex = doc.bufferedPageRange().count - 1;
      tocEntries.push({ heading: ch.heading, pageIndex });

      doc.font('Body-Bold').fontSize(16).text(ch.heading);
      doc.moveDown();
      doc.font('Body').fontSize(11).text(ch.body, {
        align: 'justify',
        paragraphGap: 6,
        lineGap: 2,
      });
    }

    // --- Fill in TOC now that page numbers are known ---
    doc.switchToPage(tocPageIndex);
    let y = doc.y;
    doc.font('Body').fontSize(11);
    for (const entry of tocEntries) {
      const pageLabel = String(entry.pageIndex + 1);
      doc.text(entry.heading, MARGIN, y, { continued: false, width: 320 });
      doc.text(pageLabel, doc.page.width - MARGIN - 40, y, { width: 40, align: 'right' });
      y += 20;
      if (y > doc.page.height - MARGIN) break; // TOC overflow guard for very long books
    }

    // --- Page numbers on every page except the title page ---
    // Drawing this close to the bottom edge sits inside pdfkit's bottom
    // margin, which otherwise makes .text() think the content overflows
    // and silently starts a new page (doubled our page count end to end).
    // Zeroing the margin just for this call keeps it on the current page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      if (i === 0) continue;
      doc.switchToPage(i);
      const originalBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Body').fontSize(9).text(String(i + 1), 0, doc.page.height - MARGIN + 20, {
        align: 'center',
      });
      doc.page.margins.bottom = originalBottom;
    }

    doc.end();
  });
}

module.exports = { renderNovelPdf };
