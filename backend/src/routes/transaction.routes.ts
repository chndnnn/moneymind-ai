import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';

const router = Router();

const transactionSchema = z.object({
  amount: z.number().positive(),
  type: z.enum(['CREDIT', 'DEBIT']),
  recipientName: z.string().optional(),
  upiId: z.string().optional(),
  description: z.string().optional(),
  transactionDate: z.string().datetime(),
});

// GET all transactions

router.get('/summary', async (req, res) => {
  try {
    const { month } = req.query;

    // Validate month format: YYYY-MM
    if (
      typeof month !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ) {
      res.status(400).json({
        success: false,
        message: 'Please provide month in YYYY-MM format',
      });
      return;
    }

    // Calculate the start and end of the selected month
    const startDate = new Date(`${month}-01T00:00:00.000Z`);

    const endDate = new Date(startDate);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);

    // Calculate income and expenses in parallel
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

    const savings = totalIncome - totalExpenses;

    res.status(200).json({
      success: true,
      data: {
        month,
        totalIncome,
        totalExpenses,
        savings,
      },
    });
  } catch (error) {
    console.error('Error generating monthly summary:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to generate monthly summary',
    });
  }
});


router.get('/', async (req, res) => {
  try {
    const {
      type,
      recipientName,
      from,
      to,
      page = '1',
      limit = '10',
    } = req.query;

    // Validate pagination
    const pageNumber = Number(page);
    const pageSize = Number(limit);

    if (
      !Number.isInteger(pageNumber) ||
      !Number.isInteger(pageSize) ||
      pageNumber < 1 ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid page or limit',
      });
      return;
    }

    // Validate transaction type
    if (
      type &&
      type !== 'CREDIT' &&
      type !== 'DEBIT'
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid transaction type',
      });
      return;
    }

    const where = {
      ...(type && {
        type: type as 'CREDIT' | 'DEBIT',
      }),

      ...(recipientName && {
        recipientName: {
          contains: recipientName as string,
          mode: 'insensitive' as const,
        },
      }),

      ...(from || to
        ? {
            transactionDate: {
              ...(from && {
                gte: new Date(from as string),
              }),
              ...(to && {
                lte: new Date(to as string),
              }),
            },
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: {
          transactionDate: 'desc',
        },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),

      prisma.transaction.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
    });
  }
});


// POST a new transaction
router.post('/', async (req, res) => {
  try {
    const validation = transactionSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        errors: validation.error.issues,
      });
      return;
    }

    const transaction = await prisma.transaction.create({
      data: {
        ...validation.data,
        source: 'MANUAL',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: transaction,
    });
  } catch (error) {
    console.error('Error creating transaction:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
    });
  }
});


router.get('/merchant-summary', async (req, res) => {
  try {
    const { month } = req.query;

    // Validate month format
    if (
      typeof month !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ) {
      res.status(400).json({
        success: false,
        message: 'Please provide month in YYYY-MM format',
      });
      return;
    }

    const startDate = new Date(`${month}-01T00:00:00.000Z`);

    const endDate = new Date(startDate);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);

    const merchantExpenses = await prisma.transaction.groupBy({
      by: ['recipientName'],
      where: {
        type: 'DEBIT',
        recipientName: {
          not: null,
        },
        transactionDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          amount: 'desc',
        },
      },
    });

    const data = merchantExpenses.map((item) => ({
      recipientName: item.recipientName,
      totalSpent: Number(item._sum.amount ?? 0),
      transactionCount: item._count.id,
    }));

    res.status(200).json({
      success: true,
      data: {
        month,
        merchants: data,
      },
    });
  } catch (error) {
    console.error('Error generating merchant summary:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to generate merchant summary',
    });
  }
});


export default router;