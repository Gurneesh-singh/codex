import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().refine((value) => value.split(',').every((origin) => z.url().safeParse(origin.trim()).success),
    'CORS_ORIGIN must contain valid URLs separated by commas').optional(),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('true'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10).optional(),
  SARVAM_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  AI4BHARAT_ASR_URL: z.string().url().optional(),
  AI4BHARAT_ASR_TOKEN: z.string().min(1).optional()
});

export const env = schema.parse(process.env);
