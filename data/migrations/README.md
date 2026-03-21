# Database Migrations

Schema changes developed against `breakroom_dev` are tracked here as numbered SQL files.

## Naming convention

```
NNN-short-description.sql
```

Example: `002-add-posts-table.sql`, `003-add-avatar-column-to-users.sql`

Start numbering at `002` — the original schema in `data/1-user-auth.sql` is effectively migration `001`.

## How to apply when releasing a new version

1. Review all `.sql` files with numbers higher than what production currently has
2. Apply them in order against the production `breakroom` database:
   ```bash
   mysql -h 44.225.148.34 -u DCAdminUser -p breakroom < data/migrations/002-example.sql
   ```
3. Deploy the new backend image and frontend

## Current production schema version

`001` — original schema from `data/1-user-auth.sql`
