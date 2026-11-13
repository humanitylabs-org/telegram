"""The view is vanilla source: validation is the build, web/ is its dist."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
import shutil
shutil.copyfile(root / 'chats/telegram.js', root / 'web/tg-view.js')  # one view, two doors: the Chats slot and this window
for name in ('index.html', 'boot.js', 'wizard-tokens.css', 'styles.css', 'app.js', 'tg-view.js'):
    assert (root / 'web' / name).is_file(), name
html = (root / 'web/index.html').read_text()
assert '/wizard-os-home/core/app-client.js' in html, 'Shared system client must load before app code'
print('View built: web/ (vanilla source, no dependencies)')
