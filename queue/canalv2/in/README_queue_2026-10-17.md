# Queue order, 2026-10-17 (Binc)
One job per Claude Code session. First message: `Run 04_TRACKER/queue/in/<file>`. Close the session when it ends.
PC, in order: job_001 .. job_009 (anchor + carry, Blender data exists). They are independent: two sessions can run two jobs at once.
PC, after or between: job_010 .. job_016 (Blender GUI track for parts with no Blender data). One at a time: they use the Blender window.
Output: 80_TEST-BUCKET/corrosion_blender-full_2026-10-17/ (mp4 per shot, flat) and 06_REVIEW job folders.
Nothing in queue/in is run by anyone but Binc's instruction.
