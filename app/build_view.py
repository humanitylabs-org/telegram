"""The view is vanilla source: validation is the build, web/ is its dist."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
# The window's CSP has no inline styles, so the view's stylesheet also ships as a file.
src = (root / 'web/tg-view.js').read_text()
css = src.split('const CSS = `', 1)[1].split('`;', 1)[0].replace('\\\\', '\\')
(root / 'web/tg-view.css').write_text(css)
for name in ('index.html', 'boot.js', 'wizard-tokens.css', 'styles.css', 'app.js', 'tg-view.js', 'tg-view.css'):
    assert (root / 'web' / name).is_file(), name
html = (root / 'web/index.html').read_text()
assert '/wizard-os-home/core/app-client.js' in html, 'Shared system client must load before app code'
print('View built: web/ (vanilla source, no dependencies)')
