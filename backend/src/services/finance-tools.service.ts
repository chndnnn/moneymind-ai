
import prisma from '../lib/prisma.js';

export async function getMonthlySummary(month: string) {
  // Validate month format
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Invalid month format. Expected YYYY-MM');
  }

  // Calculate month boundaries
  const startDate = new Date(`${month}-01T00:00:00.000Z`);

  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);

  // Fetch income and expenses concurrently
  const [incomeResult, expenseResult] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        type: 'CREDIT',
        transactionDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      _sum: {
        amount: true,
      },
    }),

    prisma.transaction.aggregate({
      where: {
        type: 'DEBIT',
        transactionDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      _sum: {
        amount: true,
      },
    }),
  ]);

  const totalIncome = Number(incomeResult._sum.amount ?? 0);
  const totalExpenses = Number(expenseResult._sum.amount ?? 0);

  return {
    month,
    totalIncome,
    totalExpenses,
    savings: totalIncome - totalExpenses,
  };
}
