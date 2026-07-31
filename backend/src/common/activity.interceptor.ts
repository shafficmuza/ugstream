import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ActivityService } from './activity.service';

/**
 * System-wide audit: logs every authenticated *mutating* request (POST/PUT/
 * PATCH/DELETE) after it succeeds, so the admin Activity view captures all
 * actions — edits, deletes, publishes, genre/kind/plan/user/settings/payment
 * changes, logins' side effects, profile updates, etc.
 *
 * Two exclusions:
 *  - SKIP: high-frequency or sub-step calls that would flood the log
 *    (watch-progress heartbeat, playback, upload chunk signing, webhooks,
 *    token refresh).
 *  - ALREADY_LOGGED: the upload/create endpoints that log richer,
 *    hand-written summaries themselves (see EpisodesController /
 *    AdminTitlesController) — skipped here to avoid duplicates.
 */
const SKIP: RegExp[] = [
  /\/episodes\/[^/]+\/progress$/,
  /\/episodes\/[^/]+\/play$/,
  /\/upload-url$/,
  /\/tus-upload$/,
  /\/r2\/multipart\//,
  /\/r2\/hls\/(begin|sign-batch)$/,
  /\/webhooks\//,
  /\/auth\/(otp|refresh)/,
];

const ALREADY_LOGGED: RegExp[] = [
  /\/admin\/titles$/, // title create
  /\/episodes$/, // add video
  /\/import-url$/,
  /\/register-r2-file$/,
  /\/register-r2-hls$/,
  /\/transcode-4k-r2$/,
  /\/transcode-4k$/,
];

interface Described {
  action: string;
  summary: string;
}

function describe(method: string, path: string): Described {
  const rules: { m?: string; re: RegExp; action: string; summary: string }[] = [
    { m: 'PATCH', re: /\/admin\/titles\/[^/]+\/publish$/, action: 'title_publish', summary: 'Published or unpublished a title' },
    { m: 'PATCH', re: /\/admin\/titles\/[^/]+$/, action: 'title_edit', summary: 'Edited a title' },
    { m: 'DELETE', re: /\/admin\/titles\/[^/]+$/, action: 'title_delete', summary: 'Deleted a title' },
    { m: 'POST', re: /\/admin\/genres$/, action: 'genre_add', summary: 'Added a genre' },
    { m: 'DELETE', re: /\/admin\/genres\/[^/]+$/, action: 'genre_delete', summary: 'Deleted a genre' },
    { m: 'POST', re: /\/admin\/kinds$/, action: 'kind_add', summary: 'Added a kind' },
    { m: 'DELETE', re: /\/admin\/kinds\/[^/]+$/, action: 'kind_delete', summary: 'Deleted a kind' },
    { m: 'PATCH', re: /\/admin\/users\/[^/]+$/, action: 'user_update', summary: 'Updated a user (role or status)' },
    { m: 'POST', re: /\/admin\/plans$/, action: 'plan_add', summary: 'Created a plan' },
    { m: 'PATCH', re: /\/admin\/plans\/[^/]+$/, action: 'plan_update', summary: 'Updated a plan' },
    { re: /\/admin\/settings\/(logo|hero-background|auth-background)$/, action: 'branding_update', summary: 'Updated a branding image' },
    { m: 'POST', re: /\/admin\/payments\/credentials$/, action: 'payment_creds', summary: 'Updated payment credentials' },
    { m: 'PATCH', re: /\/admin\/settings$/, action: 'settings_update', summary: 'Updated settings' },
    { m: 'POST', re: /\/admin\/stream\/cleanup-orphans$/, action: 'stream_cleanup', summary: 'Ran video cleanup' },
    { m: 'POST', re: /\/auth\/logout$/, action: 'logout', summary: 'Logged out' },
    { m: 'PATCH', re: /\/me$/, action: 'profile_update', summary: 'Updated their profile' },
  ];
  for (const r of rules) {
    if ((!r.m || r.m === method) && r.re.test(path)) return { action: r.action, summary: r.summary };
  }
  return { action: 'action', summary: `${method} ${path.replace(/^\/v1/, '')}` };
}

@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next.handle();

    const path: string = req.path || String(req.url || '').split('?')[0];
    const userId = req.auth?.userId as bigint | undefined;
    if (!userId) return next.handle(); // unauthenticated (e.g. login) handled elsewhere
    if (SKIP.some((re) => re.test(path)) || ALREADY_LOGGED.some((re) => re.test(path))) return next.handle();

    const { action, summary } = describe(method, path);
    // Link to a title when the route is title-scoped.
    let titleId: bigint | undefined;
    if (/\/admin\/titles\//.test(path)) {
      const raw = req.params?.titleId ?? req.params?.id;
      if (raw && /^\d+$/.test(String(raw))) titleId = BigInt(raw);
    }

    // Log only after the handler succeeds (tap's next callback).
    return next.handle().pipe(tap(() => this.activity.log(userId, action, summary, titleId)));
  }
}
