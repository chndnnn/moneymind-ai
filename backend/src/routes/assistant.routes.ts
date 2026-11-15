
import { Router } from 'express';
import { z } from 'zod';
import groq from '../lib/groq.js';

const router = Router();

const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
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

    const response = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content: `
            You are MoneyMind AI, a personal finance assistant.

            Help users understand their expenses, income,
            transactions and spending habits.

            Be friendly, concise and easy to understand.

            Do not invent financial information.
            If you don't have access to the required data,
            clearly tell the user.
          `,
        },
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const answer = response.choices[0]?.message?.content;

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
