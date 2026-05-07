select migration_name, checksum, finished_at, rolled_back_at
from "_prisma_migrations"
where migration_name = '20260506212413_align_quotation_statuses';

