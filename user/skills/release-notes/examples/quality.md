# Field Notes v3.2.1

No more endless loading on a weak connection.

A quality release. When a connection is up but sends nothing, as on a weak cafe or campground network, the app
no longer waits forever. Each download either finishes or stops, and you see what the app already shows when
something fails.

**Try it: https://fieldnotes.example**

## What changed

- **Maps on your device.** If a map area stops arriving, the map gives up after 30 seconds with nothing new and
  shows its usual message, and the next area you open tries again. Before, every area after it could wait for
  good.
- **Exporting a notebook.** An export that stops arriving now ends with the usual message that it was not saved,
  and any older copy you saved stays on the device.
- **Opening a photo.** If the photo viewer cannot load, the note shows the photo's caption and place, as it does
  for any photo it cannot open.
- **Opening the app.** If the network stays silent, the app opens from the copy it keeps after 5 seconds
  instead of showing a blank screen. A slow connection that answers first still wins.
- **Searching after setup.** A device set up for offline search uses the files it already keeps when the
  connection is silent, instead of waiting for the network.
- **A slow download is never cut.** Only silence counts: a download that keeps arriving, however slowly, is
  left to finish.

Size grows a little: the offline install is about 0.7 KB larger, and the code every page loads is about 0.6 KB
larger.

## Unchanged

Privacy, security, and licensing hold as they did in v3.2.0: your notes and places stored locally and
encrypted, no trackers, no ads, an online path that stays off until you turn it on, GPL v3, and base maps drawn
only from openly licensed public map data.
