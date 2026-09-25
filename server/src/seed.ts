import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma';

/** Creates (or promotes) the admin account from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_USERNAME. */
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  const passwordHash = await bcrypt.hash(password, 12);
  const u = await prisma.user.upsert({
    where: { email },
    create: { email, username, passwordHash, role: 'ADMIN', country: 'CW', dateOfBirth: new Date('1990-01-01') },
    update: { role: 'ADMIN', passwordHash },
  });
  console.log(`Admin ready: ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
