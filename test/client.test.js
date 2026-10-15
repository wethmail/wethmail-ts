/**
 * Testes de paridade da façade TypeScript (retry + erros tipados).
 *
 * Overlay copiado para sdk/clients/typescript-fetch/test. Corre-se, depois de
 * `npm run build`, com:  node test/client.test.js
 */

const assert = require('assert');
const http = require('http');
const { Client, APIError } = require('../dist/client.js');

function startServer(app) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', async () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const [status, headers, payload] = await app(req.method, req.url, req.headers, body);
                const out = payload || '';
                res.writeHead(status, Object.assign({ 'Content-Length': Buffer.byteLength(out) }, headers || {}));
                res.end(out);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

const json = (obj) => JSON.stringify(obj);

async function testSendEmail() {
    let seenAuth = '';
    let seenPath = '';
    const server = await startServer((method, url, headers) => {
        seenAuth = headers['authorization'];
        seenPath = url;
        return [202, { 'Content-Type': 'application/json' }, json({ id: 'e1', status: 'queued' })];
    });
    try {
        const client = new Client('wm_test_secret', { basePath: `http://127.0.0.1:${server.address().port}` });
        const got = await client.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's', body: 'b' });
        assert.strictEqual(got.id, 'e1');
        assert.strictEqual(seenAuth, 'Bearer wm_test_secret');
        assert.strictEqual(seenPath, '/v1/emails');
    } finally {
        server.close();
    }
}

async function testTypedError() {
    const server = await startServer(() => [404, { 'Content-Type': 'application/json', 'X-Request-ID': 'req-1' }, json({ erro: 'não encontrado' })]);
    try {
        const client = new Client('k', { basePath: `http://127.0.0.1:${server.address().port}` });
        let thrown;
        try {
            await client.getEmail('missing');
        } catch (e) {
            thrown = e;
        }
        assert.ok(thrown instanceof APIError, 'deve ser APIError');
        assert.strictEqual(thrown.statusCode, 404);
        assert.strictEqual(thrown.message, 'não encontrado');
        assert.strictEqual(thrown.requestId, 'req-1');
        assert.strictEqual(thrown.retryable(), false);
    } finally {
        server.close();
    }
}

async function testRetryTransient() {
    let attempts = 0;
    const server = await startServer(() => {
        attempts++;
        if (attempts < 3) {
            return [500, { 'Content-Type': 'application/json' }, json({ erro: 'boom' })];
        }
        return [202, { 'Content-Type': 'application/json' }, json({ id: 'e1', status: 'queued' })];
    });
    try {
        const client = new Client('k', { basePath: `http://127.0.0.1:${server.address().port}`, maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 });
        const got = await client.sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's', body: 'b' });
        assert.strictEqual(got.id, 'e1');
        assert.strictEqual(attempts, 3);
    } finally {
        server.close();
    }
}

async function testNoRetryOn401() {
    let attempts = 0;
    const server = await startServer(() => {
        attempts++;
        return [401, { 'Content-Type': 'application/json' }, json({ erro: 'não autorizado' })];
    });
    try {
        const client = new Client('k', { basePath: `http://127.0.0.1:${server.address().port}`, maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 });
        await assert.rejects(() => client.getEmail('e1'), (e) => e instanceof APIError && e.statusCode === 401);
        assert.strictEqual(attempts, 1);
    } finally {
        server.close();
    }
}

async function testDeleteDomain() {
    let seen;
    const server = await startServer((method, url) => {
        seen = `${method} ${url}`;
        return [204, {}, ''];
    });
    try {
        const client = new Client('k', { basePath: `http://127.0.0.1:${server.address().port}` });
        await client.deleteDomain('d1');
        assert.strictEqual(seen, 'DELETE /v1/domains/d1');
    } finally {
        server.close();
    }
}

async function testStats() {
    const server = await startServer(() => [200, { 'Content-Type': 'application/json' }, json({ total: 3, counts: { sent: 3 } })]);
    try {
        const client = new Client('k', { basePath: `http://127.0.0.1:${server.address().port}` });
        const got = await client.stats();
        assert.strictEqual(got.total, 3);
    } finally {
        server.close();
    }
}

async function main() {
    await testSendEmail();
    await testTypedError();
    await testRetryTransient();
    await testNoRetryOn401();
    await testDeleteDomain();
    await testStats();
    console.log('typescript SDK OK');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
