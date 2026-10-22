Camera Club Photobooth
======================
index.html + style.css + app.js + frames/ + logo.png  = the full app.
Open it from a local server (camera access needs localhost or HTTPS):
    python3 -m http.server 8000     then visit http://localhost:8000
photobooth-single-file.html = the same app in one file (frames and logo embedded),
as published in the artifact. Camera is blocked inside the artifact viewer, so use
Upload photos / Try sample photos there.

Edit in app.js:
  CONFIG.strip.caption   the text at the bottom of the strips (#CCS.CameraClub)
  CONFIG.logo            logo path and on/off
  LAYOUTS                every Canva frame is a twin strip (copies: 2)
