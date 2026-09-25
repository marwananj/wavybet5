import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export { Prisma };

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const money = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
