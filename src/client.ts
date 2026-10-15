/**
 * Façade de conveniência para o cliente WethMail gerado (typescript-fetch).
 *
 * Ficheiro de overlay (sdk/overlays/typescript-fetch): é copiado para o pacote
 * gerado e acrescenta o que o cliente gerado não tem — uma API estável, erros
 * tipados (`APIError`) e retries com backoff para falhas transitórias (rede,
 * 429 e 5xx).
 */

import { Configuration, FetchError, ResponseError } from './runtime';
import { DomainsApi, EmailsApi, StatsApi } from './apis';
import {
    CreateDomainRequest,
    CreateEmailRequest,
    Domain,
    DomainVerifyResponse,
    Email,
    EmailCreated,
    ModelError,
    Stats,
} from './models';

export class APIError extends Error {
    readonly statusCode: number;
    readonly requestId: string;

    constructor(statusCode: number, message: string, requestId = '') {
        super(message);
        // Necessário para que `instanceof APIError` funcione com target ES5.
        Object.setPrototypeOf(this, APIError.prototype);
        this.name = 'APIError';
        this.statusCode = statusCode;
        this.requestId = requestId;
    }

    toString(): string {
        const prefix = `wethmail: http ${this.statusCode}: ${this.message}`;
        return this.requestId ? `${prefix} (request_id=${this.requestId})` : prefix;
    }

    /** Diz se a falha é transitória e vale a pena tentar de novo. */
    retryable(): boolean {
        if (this.statusCode === 0) {
            return true;
        }
        return this.statusCode === 429 || this.statusCode >= 500;
    }
}

export interface ClientOptions {
    basePath?: string;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

const DEFAULT_BASE_PATH = 'https://api.wethmail.local';

export class Client {
    private readonly emails: EmailsApi;
    private readonly domains: DomainsApi;
    private readonly statsApi: StatsApi;
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;

    constructor(apiKey: string, options: ClientOptions = {}) {
        const configuration = new Configuration({
            basePath: (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, ''),
            accessToken: apiKey,
        });
        this.emails = new EmailsApi(configuration);
        this.domains = new DomainsApi(configuration);
        this.statsApi = new StatsApi(configuration);
        this.maxRetries = options.maxRetries ?? 2;
        this.baseDelayMs = options.baseDelayMs ?? 200;
        this.maxDelayMs = options.maxDelayMs ?? 5000;
    }

    sendEmail(createEmailRequest: CreateEmailRequest): Promise<EmailCreated> {
        return this.call(() => this.emails.createEmail({ createEmailRequest }));
    }

    getEmail(id: string): Promise<Email> {
        return this.call(() => this.emails.getEmail({ id }));
    }

    createDomain(createDomainRequest: CreateDomainRequest): Promise<Domain> {
        return this.call(() => this.domains.createDomain({ createDomainRequest }));
    }

    listDomains(): Promise<Array<Domain>> {
        return this.call(() => this.domains.listDomains());
    }

    getDomain(id: string): Promise<Domain> {
        return this.call(() => this.domains.getDomain({ id }));
    }

    verifyDomain(id: string): Promise<DomainVerifyResponse> {
        return this.call(() => this.domains.verifyDomain({ id }));
    }

    deleteDomain(id: string): Promise<void> {
        return this.call(() => this.domains.deleteDomain({ id }));
    }

    stats(since?: Date): Promise<Stats> {
        return this.call(() => this.statsApi.getStats({ since }));
    }

    private async call<T>(fn: () => Promise<T>): Promise<T> {
        let attempt = 0;
        for (;;) {
            try {
                return await fn();
            } catch (e) {
                const err = await this.mapError(e);
                if (attempt >= this.maxRetries || !err.retryable()) {
                    throw err;
                }
                await sleep(this.delayMs(attempt, e));
                attempt++;
            }
        }
    }

    private async mapError(e: unknown): Promise<APIError> {
        const responseError = asResponseError(e);
        if (responseError) {
            let message = responseError.response.statusText || 'erro desconhecido';
            try {
                const body = (await responseError.response.clone().json()) as ModelError;
                if (body && typeof body.erro === 'string' && body.erro) {
                    message = body.erro;
                }
            } catch {
                /* corpo não-JSON: usa o statusText */
            }
            return new APIError(responseError.response.status, message, responseError.response.headers.get('X-Request-ID') ?? '');
        }
        if (asFetchError(e)) {
            const message = e instanceof Error ? e.message : 'erro de rede';
            return new APIError(0, message || 'erro de rede', '');
        }
        return new APIError(0, e instanceof Error ? e.message : String(e), '');
    }

    private delayMs(attempt: number, e: unknown): number {
        const responseError = asResponseError(e);
        if (responseError) {
            const retryAfter = responseError.response.headers.get('Retry-After');
            if (retryAfter !== null && retryAfter !== '') {
                const secs = Number(retryAfter);
                if (!Number.isNaN(secs) && secs >= 0) {
                    return secs * 1000;
                }
            }
        }
        const delay = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
        return delay / 2 + Math.random() * (delay / 2);
    }
}

// Os erros gerados derivam de Error; com target ES5 o `instanceof` pode falhar,
// por isso reconhecemo-los também pela forma.
function asResponseError(e: unknown): ResponseError | undefined {
    if (e instanceof ResponseError) {
        return e;
    }
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'ResponseError' && 'response' in e) {
        return e as ResponseError;
    }
    return undefined;
}

function asFetchError(e: unknown): FetchError | undefined {
    if (e instanceof FetchError) {
        return e;
    }
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'FetchError') {
        return e as FetchError;
    }
    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
