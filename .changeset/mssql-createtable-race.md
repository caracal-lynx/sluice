---
'@caracal-lynx/sluice': patch
---

Fix a race in the mssql source adapter where a streamed `INSERT` could run before its `CREATE TABLE` resolved, producing a spurious DuckDB "Table does not exist" error on small/fast result sets. The adapter now awaits table creation before every batch insert.
