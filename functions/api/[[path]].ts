// Cloudflare Pages routes every /api/* request here; the logic lives in server/.
import { handle } from '../../server/router.ts';
import type { Env } from '../../server/env.ts';

export const onRequest: PagesFunction<Env> = ctx => handle(ctx.request, ctx.env, ctx);
