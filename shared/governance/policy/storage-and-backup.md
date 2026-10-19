# Storage and backup
- Root: ~/CANALV2 on binc-pc. Not on the IronWolf (/mnt/storage): it has pending sectors and is parking and mirror only.
- Source plates stay where they were delivered and are LINKED, never copied or moved (02_SOURCE/SOURCES.csv).
- Run output goes to a working NVMe, not the IronWolf. Every run writes per frame and can resume after a power loss.
- Backups: a zero-compression archive of everything, then that is backed up. What to include or exclude is Brynley's decision, always asked first.
- Version control: plain git, one private text-only repo (policies, scripts, templates, graphs). No plates. No client tracker or inbox. No force-push.
