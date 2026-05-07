-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('ORDER', 'QUOTATION_REQUEST');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('PROPOSED', 'COUNTERED', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'WAITING_FOR_QUOTATION';
ALTER TYPE "OrderStatus" ADD VALUE 'QUOTATION_PROVIDED';
ALTER TYPE "OrderStatus" ADD VALUE 'CLIENT_REJECTED_QUOTATION';
ALTER TYPE "OrderStatus" ADD VALUE 'WAITING_FOR_ADMIN_QUOTATION_APPROVAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "mainCategory" TEXT,
ADD COLUMN     "subCategory" TEXT,
ADD COLUMN     "type" "OrderType" NOT NULL DEFAULT 'ORDER';

-- CreateTable
CREATE TABLE "OrderQuotation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdByRole" "UserRole" NOT NULL,
    "createdById" UUID NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderQuotation_orderId_idx" ON "OrderQuotation"("orderId");

-- CreateIndex
CREATE INDEX "OrderQuotation_createdById_idx" ON "OrderQuotation"("createdById");

-- CreateIndex
CREATE INDEX "OrderQuotation_status_idx" ON "OrderQuotation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderQuotation_orderId_version_key" ON "OrderQuotation"("orderId", "version");

-- CreateIndex
CREATE INDEX "Order_type_idx" ON "Order"("type");

-- AddForeignKey
ALTER TABLE "OrderQuotation" ADD CONSTRAINT "OrderQuotation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderQuotation" ADD CONSTRAINT "OrderQuotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
