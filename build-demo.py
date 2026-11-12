from base64 import b64encode
from pathlib import Path

root = Path(__file__).resolve().parent
template = (root / "src/wohnungsdatenbank.html").read_text(encoding="utf-8")
listings = (root / "dist/listings.js").read_text(encoding="utf-8")
logo = b64encode((root / "dist/assets/mark.svg").read_bytes()).decode("ascii")
(root / "dist/wohnungsdatenbank.html").write_text(
    template.replace("/* LISTINGS */", listings).replace("LOGO_BASE64", logo),
    encoding="utf-8",
)
