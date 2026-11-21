
import { Router } from 'express';
import { z } from 'zod';
import openrouter from '../lib/openrouter.js';
import { getMonthlySummary } from '../services/finance-tools.service.js';

const router = Router();

const chatSchema = z.object({
    message: z.string().trim().min(1).max(2000),
});

const financeTools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_monthly_summary',
      description:
        'Get the total income, expenses, and savings for a specific month.',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'Month in YYYY-MM format, for example 2026-11',
          },
        },
        required: ['month'],
        additionalProperties: false,
      },
    },
  },
];

const monthlySummaryArgsSchema = z.object({
  month: z.string().regex(
    /^\d{4}-(0[1-9]|1[0-2])$/,
    'Month must be in YYYY-MM format',
  ),
});



router.post('/chat', async (req, res) => {
  try {
    const validation = chatSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: 'Please provide a valid message',
      });
      return;
    }

    const { message } = validation.data;

    // First AI request: Decide whether a tool is needed
    const response = await openrouter.chat.send({
      chatRequest: {
        model: process.env.OPENROUTER_MODEL!,
        stream: false,
        maxTokens: 1000,
        tools: financeTools,
        toolChoice: 'auto',
        messages: [
          {
            role: 'system',
            content: `
              You are MoneyMind AI, a personal finance assistant.

              Help users understand their expenses, income,
              transactions and spending habits.

              Use get_monthly_summary whenever the user asks
              about income, expenses or savings for a particular month.

              Do not invent financial information.
              Always use the available tool for financial calculations.
            `,
          },
          {
            role: 'user',
            content: message,
          },
        ],
      },
    });

    const assistantMessage = response.choices[0]?.message;

    if (!assistantMessage) {
      throw new Error('No response received from AI');
    }

    // Check whether AI requested a tool
    const toolCalls = assistantMessage.toolCalls;

    if (!toolCalls || toolCalls.length === 0) {
      res.status(200).json({
        success: true,
        answer: assistantMessage.content || 'I could not generate a response.',
      });
      return;
    }

    // Execute requested tools
    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        if (toolCall.function.name !== 'get_monthly_summary') {
          throw new Error('Unknown finance tool requested');
        }

        const args = monthlySummaryArgsSchema.safeParse(
          JSON.parse(toolCall.function.arguments),
        );

        if (!args.success) {
          throw new Error('Invalid monthly summary arguments');
        }

        const result = await getMonthlySummary(args.data.month);

        return {
          role: 'tool' as const,
          toolCallId: toolCall.id,
          content: JSON.stringify(result),
        };
      }),
    );

    // Second AI request: Generate a human-readable answer
    const finalResponse = await openrouter.chat.send({
      chatRequest: {
        model: process.env.OPENROUTER_MODEL!,
        stream: false,
        maxTokens: 1000,
        messages: [
          {
            role: 'system',
            content: `
              You are MoneyMind AI, a personal finance assistant.

              Explain financial data clearly and concisely.
              Use Indian Rupees (₹) for currency.
              Never change or invent the numbers returned by tools.
            `,
          },
          {
            role: 'user',
            content: message,
          },
          assistantMessage,
          ...toolResults,
        ],
      },
    });

    const answer = finalResponse.choices[0]?.message.content;

    res.status(200).json({
      success: true,
      answer: answer || 'I could not generate a response.',
    });

  } catch (error) {
    console.error('AI assistant error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to generate AI response',
    });
  }
});


export default router;
