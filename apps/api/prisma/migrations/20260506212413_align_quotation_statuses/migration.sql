/*
  Warnings:

  - The values [CREATED,CLIENT_REJECTED_QUOTATION,WAITING_FOR_ADMIN_QUOTATION_APPROVAL] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('WAITING_FOR_QUOTATION', 'QUOTATION_PROVIDED', 'QUOTATION_REJECTED', 'COUNTER_QUOTATION_SUBMITTED', 'IN_PROGRESS', 'REJECTED', 'COMPLETED', 'CLOSED', 'REVISION_REQUESTED', 'PENDING_PAYMENT');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_QUOTATION';
COMMIT;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_QUOTATION';

/*
  Warnings:

  - The values [CREATED,CLIENT_REJECTED_QUOTATION,WAITING_FOR_ADMIN_QUOTATION_APPROVAL] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('WAITING_FOR_QUOTATION', 'QUOTATION_PROVIDED', 'QUOTATION_REJECTED', 'COUNTER_QUOTATION_SUBMITTED', 'IN_PROGRESS', 'REJECTED', 'COMPLETED', 'CLOSED', 'REVISION_REQUESTED', 'PENDING_PAYMENT');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING (
  CASE ("status"::text)
    WHEN 'CREATED' THEN 'WAITING_FOR_QUOTATION'
    WHEN 'CLIENT_REJECTED_QUOTATION' THEN 'QUOTATION_REJECTED'
    WHEN 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL' THEN 'COUNTER_QUOTATION_SUBMITTED'
    ELSE ("status"::text)
  END
)::"OrderStatus_new";
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_QUOTATION';
COMMIT;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_QUOTATION';
