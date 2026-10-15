# WethMail TypeScript SDK

TypeScript client for the WethMail v1 transactional email API (generator
`typescript-fetch`). It wraps the generated OpenAPI client with a small stable
facade, typed errors and retries with exponential backoff (and jitter) on
transient failures.

Package: `@wethmail/sdk` (npm).

## Install

```sh
npm install @wethmail/sdk
```

## Quick start

```ts
import { Client, APIError } from '@wethmail/sdk/dist/client';
import type { CreateEmailRequest } from '@wethmail/sdk';

const client = new Client(process.env.WETHMAIL_API_KEY!, {
    basePath: 'https://api.example.com',
});

const created = await client.sendEmail({
    from: 'no-reply@mail.example.com',
    to: 'customer@example.com',
    subject: 'Confirm your address',
    body: 'Hi, please confirm your email.',
} satisfies CreateEmailRequest);

const email = await client.getEmail(created.id);
console.log('status:', email.status);
```

`sendEmail` enqueues the email and returns its id and initial status at once;
delivery is asynchronous. Poll `getEmail` until the status is `sent`, `failed`
or `bounced`.

## Configuration

`new Client(apiKey, options?)` — `ClientOptions`:

| Option | Effect | Default |
|---|---|---|
| `basePath` | API base URL | `https://api.wethmail.local` |
| `maxRetries` | Extra attempts on transient failure (`0` disables) | `2` |
| `baseDelayMs` | Delay before the first retry, in ms (doubles, up to `maxDelayMs`) | `200` |
| `maxDelayMs` | Cap on the delay, in ms | `5000` |

## Errors

```ts
try {
    await client.getEmail('missing-id');
} catch (e) {
    if (e instanceof APIError) {
        console.error(`http ${e.statusCode}: ${e.message} (request_id=${e.requestId})`);
        if (e.retryable()) {
            // transient (network, 429 or 5xx)
        }
    }
}
```

`statusCode` is `0` on a network failure, `message` is the API `erro` field and
`requestId` is the `X-Request-ID` header value. With `target: es5` `instanceof`
can fail on generated errors; the facade already recognises those by shape, and
`instanceof APIError` always works because the prototype is fixed.
