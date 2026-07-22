import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.createMany({
    data: [
      { name: 'Weekly', priceUgx: 8000, durationDays: 7 },
      { name: 'Monthly', priceUgx: 30000, durationDays: 30 },
    ],
    skipDuplicates: true,
  });

  await prisma.genre.createMany({
    data: [
      { name: 'Action', slug: 'action' },
      { name: 'Comedy', slug: 'comedy' },
      { name: 'Drama', slug: 'drama' },
      { name: 'Local Drama', slug: 'local-drama' },
      { name: 'Romance', slug: 'romance' },
    ],
    skipDuplicates: true,
  });

  // Promote yourself to admin: set your own phone here, or run
  //   UPDATE users SET role = 'admin' WHERE phone = '+2567...';
  // after your first OTP login.
  console.log('Seed complete: plans + genres created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
