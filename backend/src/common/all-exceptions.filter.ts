import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Consistent error envelope for every failure, so clients (web + mobile) can
 * rely on one shape. Passes through HttpException status/message; logs and
 * masks anything unexpected as a generic 500 (never leaks internals/stack).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = b.message ?? b.error ?? exception.message;
        error = (b.error as string) ?? error;
      }
    } else {
      // Unexpected — log the real error server-side, return a safe message.
      this.logger.error(`Unhandled ${req?.method} ${req?.url}: ${(exception as Error)?.message ?? exception}`);
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      path: req?.url,
      timestamp: new Date().toISOString(),
    });
  }
}
