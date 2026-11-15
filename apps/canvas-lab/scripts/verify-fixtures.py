from pathlib import Path
import hashlib, json, struct
import fitz

root = Path(__file__).resolve().parents[1]
fixtures = root / 'public/fixtures'
out = root.parents[1] / '.test-results/canvas-lab'
meta = json.loads((fixtures/'provenance.json').read_text(encoding='utf-8'))
with fitz.open(fixtures/'paper.pdf') as doc:
    assert len(doc) == 1, 'Fixture must be one page'
    page = doc[0]
    assert [round(page.rect.width), round(page.rect.height)] == meta['pdf']['pageSizePoints']
    x, y, width, height = meta['pdf']['regionPdfPoints']
    region = fitz.Rect(x, y, x + width, y + height)
    text = page.get_text(clip=region)
    assert '先认出原来的语境' in text
    assert '一条建议不是既有事实' in text
    matrix = fitz.Matrix(4/3, 4/3)
    page.get_pixmap(matrix=matrix).save(out/'pdf-original-render.png')
    page.get_pixmap(matrix=matrix, clip=region).save(out/'pdf-region-render.png')
    expected_size = [int(width * 4/3), int(height * 4/3)]
    png_size = list(struct.unpack('>II', (fixtures/'pdf-region.png').read_bytes()[16:24]))
    assert png_size == expected_size
record = {'pageCount': 1, 'pageSizePoints': meta['pdf']['pageSizePoints'], 'regionPdfPoints': meta['pdf']['regionPdfPoints'], 'regionPngSize': png_size, 'regionText': text, 'pdfSha256': hashlib.sha256((fixtures/'paper.pdf').read_bytes()).hexdigest(), 'verified': True}
(out/'fixture-verification.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(record, ensure_ascii=False))
