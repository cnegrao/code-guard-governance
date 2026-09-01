# Legacy monolithic Supabase migrations

These nine SQL files are historical source artifacts from the repository's original monolithic `gov_repo` migration history.

They are intentionally archived outside `supabase/migrations` and are not active or executable migrations. Do not apply them to production, rename them to production migration versions, or use them to repair remote migration history.

The files were introduced in Git commit `a99a01ba20319f013a3f8dc6890d81ff77437a0d` and were moved here byte-for-byte unchanged. Their SHA-256 checksums are recorded in `SHA256SUMS`.

The production `supabase_migrations.schema_migrations` history remains the authoritative applied-history baseline. These files are retained only for forensic review and later content comparison with the production split migrations.

The existing `supabase/migrations.zip` archive is preserved separately and unchanged.
