import { Router, type Response } from 'express';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { commerceRouter } from './commerce.js';
import { voiceRouter } from './voice.js';

export const accountRouter = Router();

const authClient = env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  : null;

type AccountContext = { user: User; dataClient: SupabaseClient };

function context(response: Response): AccountContext {
  return response.locals.account as AccountContext;
}

accountRouter.use(async (request, response, next) => {
  if (!authClient || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Supabase Auth is not configured on the API' } });
    return;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(request.header('authorization') ?? '');
  if (!match) {
    response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
    return;
  }
  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    if (error || !data.user) {
      logger.warn({ code: error?.code, status: error?.status, message: error?.message }, 'Supabase rejected account session');
      if (error?.status === 0) {
        response.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Could not reach Supabase Auth. Please try again shortly.' } });
        return;
      }
      response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Session is invalid or expired' } });
      return;
    }
    const dataClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${match[1]}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    response.locals.account = { user: data.user, dataClient } satisfies AccountContext;
    next();
  } catch (error) {
    next(error);
  }
});

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const profileSchema = z.object({
  display_name: optionalText(100),
  phone: optionalText(20)
}).strict();

const businessFields = {
  name: z.string().trim().min(1).max(160),
  phone: optionalText(20),
  address_line1: optionalText(160),
  address_line2: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  postal_code: optionalText(6),
  gstin: optionalText(15)
};
const onboardingSchema = z.object({ kind: z.enum(['supplier', 'retailer']), ...businessFields }).strict();
const businessUpdateSchema = z.object({
  name: businessFields.name.optional(),
  phone: businessFields.phone,
  address_line1: businessFields.address_line1,
  address_line2: businessFields.address_line2,
  city: businessFields.city,
  state: businessFields.state,
  postal_code: businessFields.postal_code,
  gstin: businessFields.gstin
}).strict();
const linkSchema = z.object({ retailer_business_id: z.uuid() }).strict();
const responseSchema = z.object({ accept: z.boolean() }).strict();

function invalid(response: Response, issues: z.ZodIssue[]) {
  response.status(400).json({ error: { code: 'INVALID_INPUT', message: issues[0]?.message ?? 'Invalid input' } });
}

function dataFailure(response: Response, error: { code?: string; message: string }) {
  const conflict = error.code === '23505';
  const invalidInput = error.code === '23514' || error.code === 'P0001' || error.code === '22P02';
  response.status(conflict ? 409 : invalidInput ? 400 : 502).json({
    error: { code: conflict ? 'CONFLICT' : invalidInput ? 'INVALID_INPUT' : 'DATA_ERROR', message: error.message }
  });
}

accountRouter.get('/me', async (_request, response) => {
  const { user, dataClient } = context(response);
  const [profile, business] = await Promise.all([
    dataClient.from('profiles').select('id,display_name,phone').eq('id', user.id).maybeSingle(),
    dataClient.from('businesses').select('*').eq('owner_id', user.id).maybeSingle()
  ]);
  if (profile.error) return dataFailure(response, profile.error);
  if (business.error) return dataFailure(response, business.error);
  response.json({ user: { id: user.id, email: user.email, email_verified: Boolean(user.email_confirmed_at) }, profile: profile.data, business: business.data });
});

accountRouter.patch('/me', async (request, response) => {
  const parsed = profileSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error.issues);
  const { user, dataClient } = context(response);
  const result = await dataClient.from('profiles').update(parsed.data).eq('id', user.id).select('id,display_name,phone').single();
  if (result.error) return dataFailure(response, result.error);
  response.json({ profile: result.data });
});

accountRouter.post('/business', async (request, response) => {
  const parsed = onboardingSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error.issues);
  const { dataClient } = context(response);
  const { kind, name, ...fields } = parsed.data;
  const result = await dataClient.rpc('onboard_business', {
    p_kind: kind, p_name: name,
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`p_${key}`, key === 'gstin' && value ? value.toUpperCase() : value ?? null]))
  });
  if (result.error) return dataFailure(response, result.error);
  response.status(201).json({ business: result.data });
});

accountRouter.patch('/business', async (request, response) => {
  const parsed = businessUpdateSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error.issues);
  const { user, dataClient } = context(response);
  const changes = { ...parsed.data, ...(parsed.data.gstin ? { gstin: parsed.data.gstin.toUpperCase() } : {}) };
  const result = await dataClient.from('businesses').update(changes).eq('owner_id', user.id).select('*').single();
  if (result.error) return dataFailure(response, result.error);
  response.json({ business: result.data });
});

accountRouter.get('/links', async (_request, response) => {
  const { dataClient } = context(response);
  const result = await dataClient.from('retailer_links').select(
    'id,status,supplier_business_id,retailer_business_id,supplier:businesses!retailer_links_supplier_business_id_fkey(id,name),retailer:businesses!retailer_links_retailer_business_id_fkey(id,name)'
  ).order('created_at', { ascending: false });
  if (result.error) return dataFailure(response, result.error);
  response.json({ links: result.data });
});

accountRouter.post('/links', async (request, response) => {
  const parsed = linkSchema.safeParse(request.body);
  if (!parsed.success) return invalid(response, parsed.error.issues);
  const { dataClient } = context(response);
  const result = await dataClient.rpc('request_retailer_link', { p_retailer_business_id: parsed.data.retailer_business_id });
  if (result.error) return dataFailure(response, result.error);
  response.status(201).json({ link: result.data });
});

accountRouter.post('/links/:id/respond', async (request, response) => {
  const id = z.uuid().safeParse(request.params.id);
  const body = responseSchema.safeParse(request.body);
  if (!id.success) return invalid(response, id.error.issues);
  if (!body.success) return invalid(response, body.error.issues);
  const { dataClient } = context(response);
  const result = await dataClient.rpc('respond_retailer_link', { p_link_id: id.data, p_accept: body.data.accept });
  if (result.error) return dataFailure(response, result.error);
  response.json({ link: result.data });
});

accountRouter.use('/commerce', commerceRouter);
accountRouter.use('/voice', voiceRouter);
