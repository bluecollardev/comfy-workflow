# Reviewing SBS previews in Moon Player (MoonLink)

Status: notes, 2026-11-25. Nothing is built in the app for this; the source is the vendor's pages and the plan, not a test on a headset.
Where it comes from: `CANALV2-BH-GRAPH-DELIVERY-IMPLEMENTATION-PLAN-REV-007-2026-11-24.md`, section 17 (Stereo SBS distribution and headset review).

## How a file is chosen in Moon Player
There is no push step and no "open this file" call. In the headset you pick a source, then pick the file from that source's list.

| Source | How the file gets there | How it is chosen |
|---|---|---|
| **MoonLink** (Mac or PC app) | Add the review folder to MoonLink on the Mac. | On the same Wi-Fi, MoonLink appears as a source in Moon Player; open it, browse the folder, tap the file. |
| **On my Vision Pro** (Files) | Copy the file to iCloud Drive, then move it into "On my Vision Pro"; or drag it in from Files. | Open Moon Player's local list, or long-press the file and "Open with Moon Player". |
| NAS, SMB, DLNA, WebDAV | The file sits on the share. | Add the share as a source, browse, tap. |

## Push or pull
- **MoonLink is a pull.** The headset reads the Mac's registered folder over the local network when you press play. The Mac sends nothing on its own. A file must be in the registered folder, and fully downloaded if it came through iCloud Drive, before it is listed.
- **Files / iCloud Drive is a manual copy.** You move the file to the headset yourself.
- **Automatic open is not possible** as far as the vendor pages show: no URL scheme or API that makes the headset play a given file.
- **Quest** clients use the Mac's MoonLink endpoint (MoonLink QPE); Vision Pro can use MoonLink AVP or its own file integration.

## If MoonLink does not show in Moon Player
1. Give Moon Player local network access in the headset's settings.
2. Same Wi-Fi network on both devices.
3. Allow MoonLink through the Mac firewall.
4. Force-quit other players or restart the headset (they can interfere with discovery).

## What this means for the app
- Review files go in a versioned folder on the Mac, registered in MoonLink; pods sync the finished SBS previews there (plan section 17).
- Do not use iCloud Photos Shared Albums for quality review: Apple compresses and caps the size (about 720p). Use a local folder or iCloud Drive.
- Dry run: the same SBS preview on both headsets; check eye alignment, SBS layout, aspect ratio, frame rate and playback stability, with 2D-to-3D conversion and playback enhancement off.
- **Not built:** an "Export for Moon Player" action on the Side By Side slot that copies the file into the MoonLink folder. It would save the manual copy; it could not make the headset open the file. The Side By Side slot is also empty until stereo renders exist.
- **Open:** no official page found for the Quest side (MoonLink QPE) or for version-specific settings. Check both apps before the dry run.

## Sources
- Moon Link for Apple Vision Pro: https://moonvrplayer.com/moonlinkforavp
- How to use Moon Link: https://moonvrplayer.com/blog/20/how-to-use-moon-link
- Moon Player on the App Store: https://apps.apple.com/app/id6475702609
- Apple community thread (local files): https://discussions.apple.com/thread/255459087?page=2
